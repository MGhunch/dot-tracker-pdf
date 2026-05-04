from flask import Flask, request, Response, jsonify, send_from_directory
from flask_cors import CORS
import requests
import os
from datetime import datetime
import subprocess
import tempfile

# Import embedded images
from image_data import HEADER_LOGO, AI2_LOGO, CLIENT_LOGOS, WIP_HEADER

app = Flask(__name__, static_folder='static')
CORS(app)

# Use dot-hub for data (single source of truth)
API_BASE = 'https://dot.hunch.co.nz/api'

# Pre-compute data URIs at module load time (not in functions)
HEADER_LOGO_SRC = f"data:image/webp;base64,{HEADER_LOGO}"
AI2_LOGO_SRC = f"data:image/webp;base64,{AI2_LOGO}"
WIP_HEADER_SRC = f"data:image/webp;base64,{WIP_HEADER}"

def get_header_logo_src():
    """Get base64 data URI for header logo"""
    return HEADER_LOGO_SRC

def get_ai2_logo_src():
    """Get base64 data URI for ai2 logo"""
    return AI2_LOGO_SRC

def get_client_logo_src(client_code):
    """Get base64 data URI for client logo"""
    logo = CLIENT_LOGOS.get(client_code, CLIENT_LOGOS.get('HUN'))
    return f"data:image/webp;base64,{logo}"

def get_wip_header_src():
    """Get base64 data URI for WIP header image (WEBP)"""
    return WIP_HEADER_SRC

# Historical spend data for Jul-Sep (system only has data from Oct onwards)
HISTORICAL_SPEND = {
    'ONE': {'July': 13750, 'August': 3750, 'September': 19500},
    'ONB': {'July': 11750, 'August': 26750, 'September': 13500},
    'ONS': {'July': 31500, 'August': 28500, 'September': 25500},
    'SKY': {'July': 14500, 'August': 17500, 'September': 18000},
    'FIS': {'July': 4500, 'August': 5000, 'September': 3500},
    'TOW': {'July': 12000, 'August': 12000, 'September': 6000},
}

# Load shared CSS once at startup
CSS_PATH = os.path.join(os.path.dirname(__file__), 'static', 'css', 'report.css')
try:
    with open(CSS_PATH, 'r') as f:
        SHARED_CSS = f.read()
except FileNotFoundError:
    SHARED_CSS = '/* CSS file not found */'


def sort_projects(projects):
    """Sort projects by job number, with 000 and 001 jobs at the bottom"""
    def sort_key(p):
        job_number = p.get('jobNumber', '')
        # Extract the numeric part (e.g., "SKY 012" -> "012")
        parts = job_number.split(' ')
        num_part = parts[1] if len(parts) > 1 else '999'
        
        # 000 goes last, 001 second to last
        if num_part == '000':
            return (2, num_part)  # Last
        elif num_part == '001':
            return (1, num_part)  # Second to last
        else:
            return (0, num_part)  # Normal sort by number
    
    return sorted(projects, key=sort_key)


def get_previous_quarter(current_quarter):
    """Get the previous quarter label"""
    quarter_map = {
        'Q1': 'Q4',
        'Q2': 'Q1', 
        'Q3': 'Q2',
        'Q4': 'Q3'
    }
    return quarter_map.get(current_quarter, 'Q1')


def get_quarter_months(month):
    """Get the 3 months in a quarter based on any month in that quarter"""
    quarter_groups = {
        'October': ['October', 'November', 'December'],
        'November': ['October', 'November', 'December'],
        'December': ['October', 'November', 'December'],
        'January': ['January', 'February', 'March'],
        'February': ['January', 'February', 'March'],
        'March': ['January', 'February', 'March'],
        'April': ['April', 'May', 'June'],
        'May': ['April', 'May', 'June'],
        'June': ['April', 'May', 'June'],
        'July': ['July', 'August', 'September'],
        'August': ['July', 'August', 'September'],
        'September': ['July', 'August', 'September'],
    }
    return quarter_groups.get(month, ['January', 'February', 'March'])


def get_previous_quarter_months(current_quarter_months):
    """Get the 3 months from the previous quarter"""
    # Calendar quarter order
    quarter_order = [
        ['October', 'November', 'December'],
        ['January', 'February', 'March'],
        ['April', 'May', 'June'],
        ['July', 'August', 'September'],
    ]
    
    # Find current quarter index
    for i, q in enumerate(quarter_order):
        if q == current_quarter_months:
            # Return previous quarter (wrap around)
            prev_index = (i - 1) % 4
            return quarter_order[prev_index]
    
    # Default to Oct-Dec if not found
    return ['October', 'November', 'December']


def get_quarter_label_for_months(months, year_end):
    """
    Get the quarter label (Q1-Q4) for a set of months based on client's year end.
    
    Year ends and their Q1 start months:
    - September year end (Tower): Q1 starts October
    - June year end (Sky, Eon): Q1 starts July
    - March year end (everyone else): Q1 starts April
    """
    # Determine which quarter group these months belong to
    first_month = months[0] if months else 'January'
    
    # Map year end to quarter labels for each month group
    quarter_labels = {
        'September': {  # Tower: Oct=Q1, Jan=Q2, Apr=Q3, Jul=Q4
            'October': 'Q1',
            'January': 'Q2',
            'April': 'Q3',
            'July': 'Q4'
        },
        'June': {  # Sky, Eon: Jul=Q1, Oct=Q2, Jan=Q3, Apr=Q4
            'July': 'Q1',
            'October': 'Q2',
            'January': 'Q3',
            'April': 'Q4'
        },
        'March': {  # Everyone else: Apr=Q1, Jul=Q2, Oct=Q3, Jan=Q4
            'April': 'Q1',
            'July': 'Q2',
            'October': 'Q3',
            'January': 'Q4'
        }
    }
    
    # Get the quarter start month for this group
    quarter_starts = {
        'October': 'October',
        'November': 'October',
        'December': 'October',
        'January': 'January',
        'February': 'January',
        'March': 'January',
        'April': 'April',
        'May': 'April',
        'June': 'April',
        'July': 'July',
        'August': 'July',
        'September': 'July'
    }
    
    quarter_start = quarter_starts.get(first_month, 'January')
    labels = quarter_labels.get(year_end, quarter_labels['March'])
    
    return labels.get(quarter_start, 'Q1')


def get_client_data(client_code):
    """Fetch client info from dot-remote-api"""
    try:
        response = requests.get(f"{API_BASE}/tracker/clients")
        if response.status_code == 200:
            clients = response.json()
            for c in clients:
                if c.get('code') == client_code:
                    current_q = c.get('currentQuarter', 'Q1')
                    # Prefer rolloverObject from tracker.py (server-side calc).
                    # Falls back to legacy 'rollover' Airtable formula only if
                    # rolloverObject is absent entirely (i.e. tracker.py errored
                    # on the Hub). If rolloverObject is present but lastQuarter
                    # is None, that means rollover legitimately resolved to $0
                    # and we should NOT fall back.
                    if 'rolloverObject' in c:
                        last_q = (c.get('rolloverObject') or {}).get('lastQuarter')
                        rollover_credit = (last_q or {}).get('remaining', 0)
                    else:
                        rollover_credit = c.get('rollover', 0) or 0
                    return {
                        'name': c.get('name', client_code),
                        'code': client_code,
                        'monthlyCommitted': c.get('committed', 10000),
                        'rolloverCredit': rollover_credit,
                        'rolloverQuarter': get_previous_quarter(current_q),  # Quarter it came FROM
                        'rolloverUseIn': c.get('rolloverUseIn', ''),  # Quarter label to USE it in
                        'currentQuarter': current_q,
                        'yearEnd': c.get('yearEnd', 'March')
                    }
    except Exception as e:
        print(f"Error fetching client data: {e}")
    return None


def get_tracker_data(client_code, month=None):
    """Fetch tracker records from dot-remote-api"""
    try:
        response = requests.get(f"{API_BASE}/tracker/data?client={client_code}")
        if response.status_code == 200:
            records = response.json()
            result = []
            
            for r in records:
                # Filter by month if specified
                if month and r.get('month') != month:
                    continue
                    
                result.append({
                    'jobNumber': r.get('jobNumber', ''),
                    'projectName': r.get('projectName', ''),
                    'owner': r.get('owner', ''),
                    'description': r.get('description', ''),
                    'spend': r.get('spend', 0) or 0,
                    'spendType': r.get('spendType', 'Project budget'),
                    'ballpark': r.get('ballpark', False),
                    'onUs': r.get('spendType') == 'Project on us',
                    'month': r.get('month', '')
                })
            
            # Sort by spend descending
            result.sort(key=lambda x: x['spend'], reverse=True)
            return result
    except Exception as e:
        print(f"Error fetching tracker data: {e}")
    return []


def aggregate_quarterly_data(tracker_data):
    """For quarterly view, keep individual rows without modifying descriptions"""
    
    result = []
    for record in tracker_data:
        month = record.get('month', '')
        description = record.get('description', '')
        
        result.append({
            'jobNumber': record.get('jobNumber', ''),
            'projectName': record.get('projectName', ''),
            'owner': record.get('owner', ''),
            'description': description,
            'spend': record.get('spend', 0) or 0,
            'spendType': record.get('spendType', 'Project budget'),
            'ballpark': record.get('ballpark', False),
            'onUs': record.get('onUs', False),
            'month': month
        })
    
    # Sort by spend descending
    result.sort(key=lambda x: x['spend'], reverse=True)
    return result


def format_currency(amount):
    """Format number as currency"""
    if amount == 0:
        return '$0'
    if amount >= 1000:
        return f'${amount/1000:.0f}K' if amount % 1000 == 0 else f'${amount:,.0f}'
    return f'${amount:,.0f}'


def format_currency_full(amount):
    """Format number as full currency (for table)"""
    if amount == 0:
        return '$0'
    return f'${amount:,.0f}'


def build_project_row(project, truncate=False):
    """Build HTML for a project table row"""
    ballpark_class = ' ballpark' if project['ballpark'] else ''
    onus_class = ' onus' if project['onUs'] else ''
    amount_class = f'amount{ballpark_class}{onus_class}'
    desc_class = ' class="description"' if truncate else ''
    
    # Show actual value for all items (including On Us)
    display_amount = format_currency_full(project['spend'])
    
    return f'''
        <tr>
            <td class="project-name">{project['jobNumber']} · {project['projectName']}</td>
            <td>{project['owner']}</td>
            <td{desc_class}>{project['description']}</td>
            <td class="{amount_class}">{display_amount}</td>
        </tr>
    '''


def round_to_hundred(amount):
    """Round amount to nearest $100"""
    return round(amount / 100) * 100


def build_monthly_summary(tracker_data, quarter_months):
    """Build monthly summary table data for quarterly report front page"""
    summary = {}
    for m in quarter_months:
        summary[m] = {
            'key_project_count': 0,  # Excludes 000 jobs
            'key_project_spend': 0,  # Spend from non-000 jobs only (for average)
            'total_spend': 0,  # All spend including 000
            'confirmed_spend': 0,  # Non-ballpark spend
            'ballpark_spend': 0,  # Ballpark spend
        }
    
    for record in tracker_data:
        if record['spendType'] == 'Project budget':
            m = record.get('month', '')
            if m in summary:
                spend = record.get('spend', 0) or 0
                job_number = record.get('jobNumber', '')
                is_ballpark = record.get('ballpark', False)
                
                summary[m]['total_spend'] += spend
                
                # Track ballpark vs confirmed
                if is_ballpark:
                    summary[m]['ballpark_spend'] += spend
                else:
                    summary[m]['confirmed_spend'] += spend
                
                # Check if it's a 000 job (retainer)
                if ' 000' not in job_number:
                    summary[m]['key_project_count'] += 1
                    summary[m]['key_project_spend'] += spend
    
    return summary


def build_other_stuff_summary(tracker_data):
    """Build other stuff summary for quarterly report front page"""
    extra_budget = {'count': 0, 'spend': 0}
    on_us = {'count': 0, 'value': 0, 'items': []}
    
    for record in tracker_data:
        spend_type = record.get('spendType', '')
        spend = record.get('spend', 0) or 0
        
        if spend_type == 'Extra budget':
            extra_budget['count'] += 1
            extra_budget['spend'] += spend
        elif spend_type == 'Project on us':
            on_us['count'] += 1
            on_us['value'] += spend  # Track value for display
            on_us['items'].append(record)
    
    return {'extra_budget': extra_budget, 'on_us': on_us}


def build_monthly_detail_sections(tracker_data, quarter_months):
    """Build detailed monthly sections for quarterly report back page"""
    # Group by month
    by_month = {m: [] for m in quarter_months}
    
    for record in tracker_data:
        if record['spendType'] == 'Project budget':
            m = record.get('month', '')
            if m in by_month:
                by_month[m].append(record)
    
    # Sort each month by spend descending
    for m in by_month:
        by_month[m].sort(key=lambda x: x.get('spend', 0) or 0, reverse=True)
    
    return by_month


def build_html(client, tracker_data, month, is_quarter=False, all_quarter_data=None, prev_quarter_data=None):
    """Build the complete HTML document"""
    
    # For chart, use all_quarter_data if provided, otherwise use tracker_data
    chart_data = all_quarter_data if all_quarter_data else tracker_data
    
    # Previous quarter data for chart (empty list if not provided)
    prev_chart_data = prev_quarter_data if prev_quarter_data else []
    
    # Determine quarter info
    quarter_months = get_quarter_months(month)
    display_quarter_label = get_quarter_label_for_months(quarter_months, client['yearEnd'])
    
    # If quarterly view, add month prefix to descriptions (for back page)
    if is_quarter:
        tracker_data = aggregate_quarterly_data(tracker_data)
    
    # Separate projects from other stuff
    projects = [r for r in tracker_data if r['spendType'] == 'Project budget']
    other_stuff = [r for r in tracker_data if r['spendType'] != 'Project budget']
    
    # Sort projects by job number, with 000/001 at bottom
    projects = sort_projects(projects)
    other_stuff.sort(key=lambda x: x['spend'] or 0, reverse=True)
    
    # Calculate totals - ONLY Project budget counts toward committed
    projects_total = sum(p['spend'] or 0 for p in projects)
    grand_total = projects_total  # Other Stuff doesn't count against committed
    
    # Get client numbers - multiply by 3 for quarterly
    if is_quarter:
        committed = client['monthlyCommitted'] * 3
    else:
        committed = client['monthlyCommitted']
    
    # Rollover only applies if rolloverUseIn matches the quarter we're showing
    rollover_use_in = client.get('rolloverUseIn', '')
    rollover_quarter = client['rolloverQuarter']  # Quarter it came FROM
    
    # Check if rollover applies to this report
    # rollover_use_in is calendar quarter like 'JAN-MAR'
    # quarter_range is also calendar quarter like 'JAN-MAR'
    # So we compare these directly, not to the fiscal quarter label
    quarter_range_check = f"{quarter_months[0][:3].upper()}-{quarter_months[2][:3].upper()}"
    rollover_applies = (rollover_use_in == quarter_range_check)
    
    if rollover_applies:
        rollover = client['rolloverCredit']
    else:
        rollover = 0
    
    # Available is just committed (rollover shown separately, not added)
    available = committed
    remaining = available - grand_total
    spend_percent = min(100, round((grand_total / available) * 100)) if available > 0 else 0
    
    # Determine if overspent
    is_overspent = remaining < 0
    
    # Color classes
    remaining_class = 'orange' if is_overspent else 'red'
    progress_class = 'over' if is_overspent else ''
    
    # Format dates
    today = datetime.now()
    report_date = today.strftime('%d %b %Y')
    report_date_short = today.strftime('%d %b').upper()  # "11 JAN" format for footer
    quarter_label = display_quarter_label  # Use the calculated quarter label
    
    # Quarter month range for display (e.g., "OCT-DEC")
    month_abbrevs = [m[:3].upper() for m in quarter_months]
    quarter_range = f"{month_abbrevs[0]}-{month_abbrevs[2]}"
    
    # Rollover box and note - only show if rollover > 0
    rollover_box_html = ''
    rollover_note_html = ''
    rollover_line_html = ''
    if rollover > 0:
        # Subtle line under stats instead of 4th box
        rollover_line_html = f'''
            <div class="rollover-credit">
                <div class="rollover-label">ROLLOVER</div>
                <div class="rollover-amount">+{format_currency(rollover)} credit from {rollover_quarter}</div>
            </div>'''
        rollover_note_html = '<li><strong>Rollover</strong> – You can use your rollover credit any time during the quarter. It\'s extra on top of committed spend.</li>'
    
    # Grid columns - always 3 now (rollover is separate line)
    grid_columns = 'repeat(3, 1fr)'
    
    # Build quarterly or monthly specific content
    if is_quarter:
        return build_quarterly_html(
            client, tracker_data, projects, other_stuff, quarter_months,
            committed, grand_total, remaining, rollover, rollover_quarter,
            spend_percent, is_overspent, remaining_class, progress_class,
            rollover_line_html, rollover_note_html, grid_columns,
            quarter_label, quarter_range, report_date_short, today, display_quarter_label,
            prev_chart_data
        )
    else:
        return build_monthly_html(
            client, chart_data, projects, other_stuff, month,
            committed, grand_total, remaining, rollover, rollover_quarter,
            spend_percent, is_overspent, remaining_class, progress_class,
            rollover_line_html, rollover_note_html, grid_columns,
            quarter_label, report_date_short, today, prev_chart_data
        )


def build_quarterly_html(client, tracker_data, projects, other_stuff, quarter_months,
                         committed, grand_total, remaining, rollover, rollover_quarter,
                         spend_percent, is_overspent, remaining_class, progress_class,
                         rollover_line_html, rollover_note_html, grid_columns,
                         quarter_label, quarter_range, report_date, today, display_quarter_label,
                         prev_chart_data):
    """Build HTML for quarterly report (2 pages: summary + detail)"""
    
    # Build monthly summary for front page
    monthly_summary = build_monthly_summary(tracker_data, quarter_months)
    
    # Build other stuff summary
    other_summary = build_other_stuff_summary(tracker_data)
    has_other_stuff = other_summary['on_us']['count'] > 0  # Only On Us shows in table
    has_extra_budget = other_summary['extra_budget']['count'] > 0  # Extra budget goes to footnote
    
    # Build extra budget footnote
    extra_budget_note = ''
    if has_extra_budget:
        extra_budget_note = f'<li><strong>Extra projects</strong> – Plus {format_currency(other_summary["extra_budget"]["spend"])} extra projects outside of committed spend.</li>'
    
    # Build chart data - spend per month (monthly committed, not quarterly)
    monthly_committed = committed // 3  # Monthly budget
    chart_max = monthly_committed + 10000  # Y-axis max (committed + headroom for overspend)
    
    # Grey bar height - committed level as % of chart max
    committed_pct = (monthly_committed / chart_max) * 100
    
    # Build y-axis labels (5 labels from max to 0)
    y_axis_html = ''
    for i in range(5, -1, -1):
        value = int(chart_max * i / 5)
        label = f'${value // 1000}k' if value >= 1000 else f'${value}'
        y_axis_html += f'<span class="y-label">{label}</span>\n                        '
    
    # Get previous quarter months and their spend
    prev_quarter_months = get_previous_quarter_months(quarter_months)
    
    # Calculate spend for previous quarter months from prev_chart_data
    def get_prev_month_spend(month):
        confirmed = sum(d.get('spend', 0) for d in prev_chart_data 
                       if d.get('month') == month and d.get('spendType') == 'Project budget' and not d.get('ballpark', False))
        ballpark = sum(d.get('spend', 0) for d in prev_chart_data 
                      if d.get('month') == month and d.get('spendType') == 'Project budget' and d.get('ballpark', False))
        return confirmed, ballpark
    
    # Build chart bars - previous quarter first, then current quarter
    chart_bars_html = ''
    
    # Previous quarter bars
    for m in prev_quarter_months:
        confirmed_spend, ballpark_spend = get_prev_month_spend(m)
        month_abbrev = m[:3]
        # Spend as % of chart max (so it scales correctly against grey bar)
        confirmed_pct = (confirmed_spend / chart_max) * 100 if confirmed_spend > 0 else 0
        ballpark_pct = (ballpark_spend / chart_max) * 100 if ballpark_spend > 0 else 0
        ballpark_bottom = confirmed_pct  # Ballpark bar sits on top of confirmed
        
        chart_bars_html += f'''
            <div class="bar-group">
                <div class="bar-stack" >
                    <div class="bar-committed" style="height: {committed_pct}%;"></div>
                    <div class="bar-spend" style="height: {confirmed_pct}%;"></div>
                    <div class="bar-ballpark" style="height: {ballpark_pct}%; bottom: {ballpark_bottom}%;"></div>
                </div>
                <span class="bar-label">{month_abbrev}</span>
            </div>'''
    
    # Current quarter bars
    current_month = today.strftime('%B')
    for m in quarter_months:
        confirmed_spend = monthly_summary[m]['confirmed_spend']
        ballpark_spend = monthly_summary[m]['ballpark_spend']
        month_abbrev = m[:3]
        confirmed_pct = (confirmed_spend / chart_max) * 100 if confirmed_spend > 0 else 0
        ballpark_pct = (ballpark_spend / chart_max) * 100 if ballpark_spend > 0 else 0
        ballpark_bottom = confirmed_pct  # Ballpark bar sits on top of confirmed
        
        # Check if this month is in the future
        month_order = ['January', 'February', 'March', 'April', 'May', 'June', 
                       'July', 'August', 'September', 'October', 'November', 'December']
        is_future = month_order.index(m) > month_order.index(current_month)
        future_class = ' future' if is_future else ''
        
        chart_bars_html += f'''
            <div class="bar-group">
                <div class="bar-stack" >
                    <div class="bar-committed{future_class}" style="height: {committed_pct}%;"></div>
                    <div class="bar-spend" style="height: {confirmed_pct}%;"></div>
                    <div class="bar-ballpark" style="height: {ballpark_pct}%; bottom: {ballpark_bottom}%;"></div>
                </div>
                <span class="bar-label">{month_abbrev}</span>
            </div>'''
    
    # Calculate committed line position (as % from bottom)
    committed_line_bottom = committed_pct
    
    # Build summary table rows
    summary_rows = ''
    total_key_projects = 0
    total_spend = 0
    total_key_spend = 0
    
    for m in quarter_months:
        data = monthly_summary[m]
        key_count = data['key_project_count']
        key_spend = data['key_project_spend']
        month_spend = round_to_hundred(data['total_spend'])
        
        total_key_projects += key_count
        total_spend += data['total_spend']
        total_key_spend += key_spend
        
        # Build "Projects" description - average is total spend / project count
        if key_count == 0:
            if month_spend > 0:
                worked_on = "Retainer only"
            else:
                worked_on = "Nothing from you this month"
        elif key_count == 1:
            avg = round_to_hundred(month_spend)  # Total spend for one project
            worked_on = f"One project ({format_currency(avg)})"
        else:
            avg = round_to_hundred(month_spend / key_count) if key_count > 0 else 0
            # Use words for 1-9
            num_words = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine']
            count_str = num_words[key_count] if key_count < 10 else str(key_count)
            worked_on = f"{count_str} projects (average {format_currency(avg)})"
        
        summary_rows += f'''
            <tr>
                <td>{m}</td>
                <td>{worked_on}</td>
                <td style="text-align: right;">{format_currency(month_spend)}</td>
            </tr>'''
    
    # Quarter total row
    total_spend_rounded = round_to_hundred(total_spend)
    
    summary_rows += f'''
        <tr class="total-row">
            <td></td>
            <td></td>
            <td style="text-align: right;"><strong>{format_currency(total_spend_rounded)}</strong></td>
        </tr>'''
    
    # Build Projects On Us section (only on_us items, not extra_budget)
    other_stuff_html = ''
    if has_other_stuff:
        on_us_rows = ''
        for item in other_summary['on_us']['items']:
            on_us_rows += f'''
                <tr>
                    <td class="project-name">{item['jobNumber']} · {item['projectName']}</td>
                    <td>{item.get('owner', '')}</td>
                    <td class="description">{item.get('description', '')}</td>
                    <td class="amount">{format_currency_full(item.get('spend', 0))}</td>
                </tr>'''
        
        other_stuff_html = f'''
        <div class="projects-section">
            <div class="section-title">Projects On Us</div>
            <table class="projects-table">
                <thead>
                    <tr>
                        <th style="width: 35%;">Project</th>
                        <th style="width: 20%;">Owner</th>
                        <th>Description</th>
                        <th style="width: 70px;">Value</th>
                    </tr>
                </thead>
                <tbody>
                    {on_us_rows}
                </tbody>
            </table>
        </div>'''
    
    # Build monthly detail sections for back page(s) with pagination
    monthly_detail = build_monthly_detail_sections(tracker_data, quarter_months)
    
    # Pagination: max 12 rows per page
    MAX_ROWS_PER_PAGE = 12
    
    # Build sections with row counts
    sections_to_place = []  # List of (html, row_count) tuples
    
    for m in quarter_months:
        month_projects = monthly_detail[m]
        if not month_projects:
            continue
        
        month_total = sum(p.get('spend', 0) or 0 for p in month_projects)
        row_count = len(month_projects) + 2  # +2 for header and subtotal
        
        rows = ''
        for p in month_projects:
            ballpark_class = ' ballpark' if p.get('ballpark') else ''
            amount = format_currency_full(p.get('spend', 0))
            rows += f'''
                <tr>
                    <td class="project-name">{p['jobNumber']} · {p['projectName']}</td>
                    <td>{p.get('owner', '')}</td>
                    <td class="description">{p.get('description', '')}</td>
                    <td class="amount{ballpark_class}">{amount}</td>
                </tr>'''
        
        section_html = f'''
        <div class="projects-section">
            <div class="section-title">{m}</div>
            <table class="projects-table">
                <thead>
                    <tr>
                        <th style="width: 30%;">Project</th>
                        <th style="width: 18%;">Owner</th>
                        <th>Description</th>
                        <th style="width: 70px;">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    {rows}
                    <tr class="subtotal-row">
                        <td></td>
                        <td></td>
                        <td></td>
                        <td class="amount"><strong>{format_currency_full(month_total)}</strong></td>
                    </tr>
                </tbody>
            </table>
        </div>'''
        
        sections_to_place.append((section_html, row_count))
    
    # Distribute sections across pages
    detail_pages = []  # List of page content strings
    current_page_content = ''
    current_page_rows = 0
    
    for section_html, row_count in sections_to_place:
        # Would this section fit on current page?
        if current_page_rows + row_count > MAX_ROWS_PER_PAGE and current_page_rows > 0:
            # Start new page
            detail_pages.append(current_page_content)
            current_page_content = ''
            current_page_rows = 0
        
        current_page_content += section_html
        current_page_rows += row_count
    
    # Don't forget the last page
    if current_page_content:
        detail_pages.append(current_page_content)
    
    # For backwards compatibility, set these (used in template below)
    detail_sections = detail_pages[0] if detail_pages else ''
    other_detail_html = ''  # Now included in sections_to_place
    extra_detail_pages = detail_pages[1:] if len(detail_pages) > 1 else []
    
    # Build the head section with CSS (can't use f-string because CSS has curly braces)
    html_head = '''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tracker Report</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap" rel="stylesheet">
    <style>
''' + SHARED_CSS + '''
    </style>
</head>
'''
    
    # Build the body with f-string (no CSS curly brace conflicts)
    html_body = f'''<body>
    <!-- Page 1: Summary -->
    <div class="page">
        <header class="header">
            <div class="header-left">
                <img src="{get_header_logo_src()}" alt="Tracker" class="header-logo">
            </div>
            <div class="header-right">
                <img src="{get_client_logo_src(client['code'])}" alt="{client['name']}" class="client-logo">
            </div>
        </header>
        
        <div class="report-title-row">
            <div class="client-name">{client['name']}</div>
            <div class="report-meta-block">
                <div class="report-meta">{quarter_label} · {quarter_range} {today.year}</div>
            </div>
        </div>
        
        <div class="numbers-section">
            <div class="numbers-grid" style="grid-template-columns: {grid_columns};">
                <div class="stat-box">
                    <div class="stat-value grey">{format_currency(committed)}</div>
                    <div class="stat-label">Committed</div>
                </div>
                <div class="stat-box">
                    <div class="stat-value">{format_currency(grand_total)}</div>
                    <div class="stat-label">To Date</div>
                </div>
                <div class="stat-box">
                    <div class="stat-value {remaining_class}">{"+" if remaining < 0 else ""}{format_currency(abs(remaining))}</div>
                    <div class="stat-label">{'Over' if remaining < 0 else 'To Spend'}</div>
                </div>
            </div>
            <div class="progress-bar">
                <div class="progress-fill {progress_class}" style="width: {spend_percent}%;"></div>
            </div>{rollover_line_html}
        </div>
        
        <div class="projects-section">
            <div class="section-title">Summary</div>
            <table class="summary-table">
                <thead>
                    <tr>
                        <th>Month</th>
                        <th>We Worked On</th>
                        <th style="text-align: right;">Spend</th>
                    </tr>
                </thead>
                <tbody>
                    {summary_rows}
                </tbody>
            </table>
        </div>
        
        {other_stuff_html}
        
        <div class="section-title" style="text-align: right; margin-top: 12px;">See projects over the page →</div>
        
        <div class="bottom-row">
            <div class="chart-section">
                <div class="section-title">Tracker</div>
                <div class="chart-wrapper">
                    <div class="y-axis">
                        {y_axis_html}
                    </div>
                    <div class="chart-container">
                        <div class="committed-line" style="bottom: {committed_line_bottom}%;"></div>
                        {chart_bars_html}
                    </div>
                </div>
                <div class="chart-legend">
                    <div class="legend-item"><div class="legend-swatch spend" style="background: #ED1C24;"></div><span>Projects</span></div>
                    <div class="legend-item"><div class="legend-swatch committed-swatch" style="background: #e0e0e0;"></div><span>Committed</span></div>
                    <div class="legend-item"><div class="legend-swatch ballpark" style="background: #ED1C24; opacity: 0.4;"></div><span>Ballpark</span></div>
                </div>
            </div>
            
            <div class="notes-section">
                <div class="section-title">Notes</div>
                <ul class="notes-list">
                    <li><strong>Always on</strong> – This covers ongoing support, consults, and reporting outside specific jobs.</li>
                    <li><strong>Ballparks</strong> – Red numbers are ballparks. Most jobs start as a $5K ballpark before we lock in scope.</li>
                    {rollover_note_html}
                    {extra_budget_note}
                </ul>
            </div>
        </div>
        
        <footer class="footer">
            <div class="footer-left">
                <img src="{get_ai2_logo_src()}" alt="ai²" class="footer-logo">
            </div>
            <div class="footer-tagline">agency intuition × artificial intelligence</div>
            <div class="footer-date">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
                {report_date}
            </div>
        </footer>
    </div>
    
    <!-- Page 2: Detail -->
    <div class="page">
        <header class="header">
            <div class="header-left">
                <img src="{get_header_logo_src()}" alt="Tracker" class="header-logo">
            </div>
            <div class="header-right">
                <img src="{get_client_logo_src(client['code'])}" alt="{client['name']}" class="client-logo">
            </div>
        </header>
        
        <div class="page-2-header">{client['name']} · {quarter_label} Detail</div>
        
        {detail_sections}
        
        <footer class="footer">
            <div class="footer-left">
                <img src="{get_ai2_logo_src()}" alt="ai²" class="footer-logo">
            </div>
            <div class="footer-tagline">agency intuition × artificial intelligence</div>
            <div class="footer-date">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
                {report_date}
            </div>
        </footer>
    </div>
</body>
</html>'''
    
    # Build extra detail pages if needed
    extra_pages_html = ''
    for page_content in extra_detail_pages:
        extra_pages_html += f'''
    <div class="page">
        <header class="header">
            <div class="header-left">
                <img src="{get_header_logo_src()}" alt="Tracker" class="header-logo">
            </div>
            <div class="header-right">
                <img src="{get_client_logo_src(client['code'])}" alt="{client['name']}" class="client-logo">
            </div>
        </header>
        
        {page_content}
        
        <footer class="footer">
            <div class="footer-left">
                <img src="{get_ai2_logo_src()}" alt="ai²" class="footer-logo">
            </div>
            <div class="footer-tagline">agency intuition × artificial intelligence</div>
            <div class="footer-date">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
                {report_date}
            </div>
        </footer>
    </div>'''
    
    # Insert extra pages before closing body tag
    if extra_pages_html:
        html_body = html_body.replace('</body>', extra_pages_html + '</body>')
    
    return html_head + html_body


def build_monthly_html(client, tracker_data, projects, other_stuff, month,
                       committed, grand_total, remaining, rollover, rollover_quarter,
                       spend_percent, is_overspent, remaining_class, progress_class,
                       rollover_line_html, rollover_note_html, grid_columns,
                       quarter_label, report_date, today, prev_chart_data):
    """Build HTML for monthly report (original single-page layout)"""
    
    # Separate On Us from Extra Budget in other_stuff
    on_us_items = [r for r in other_stuff if r.get('spendType') == 'Project on us']
    extra_budget_items = [r for r in other_stuff if r.get('spendType') == 'Extra budget']
    
    has_other_stuff = len(on_us_items) > 0  # Only On Us shows in table
    has_extra_budget = len(extra_budget_items) > 0
    
    # Build extra budget footnote
    extra_budget_note = ''
    if has_extra_budget:
        extra_budget_total = sum(r.get('spend', 0) for r in extra_budget_items)
        extra_budget_note = f'<li><strong>Extra projects</strong> – Plus {format_currency(extra_budget_total)} extra projects outside of committed spend.</li>'
    
    # Show all projects including 000/001 admin jobs
    real_projects = projects
    admin_projects = [p for p in projects if p['jobNumber'].split(' ')[1] in ('000', '001')]
    
    max_page1_projects = 4 if has_other_stuff else 7
    page1_projects = real_projects[:max_page1_projects]
    page2_projects = real_projects[max_page1_projects:]
    needs_page2 = len(page2_projects) > 0
    
    # Check if we have real projects or just admin jobs
    has_real_projects = len(real_projects) > 0
    
    # Build chart data - same as quarterly (prev quarter + current quarter)
    quarter_months = get_quarter_months(month)
    monthly_committed = committed  # Already monthly for monthly report
    chart_max = monthly_committed + 10000  # Y-axis max (committed + headroom)
    
    # Grey bar height - committed level as % of chart max
    committed_pct = (monthly_committed / chart_max) * 100
    
    # Build y-axis labels (5 labels from max to 0)
    y_axis_html = ''
    for i in range(5, -1, -1):
        value = int(chart_max * i / 5)
        label = f'${value // 1000}k' if value >= 1000 else f'${value}'
        y_axis_html += f'<span class="y-label">{label}</span>\n                        '
    
    # Get previous quarter months
    prev_quarter_months = get_previous_quarter_months(quarter_months)
    
    # Calculate spend for a month from prev_chart_data
    def get_prev_month_spend(m):
        confirmed = sum(d.get('spend', 0) for d in prev_chart_data 
                       if d.get('month') == m and d.get('spendType') == 'Project budget' and not d.get('ballpark', False))
        ballpark = sum(d.get('spend', 0) for d in prev_chart_data 
                      if d.get('month') == m and d.get('spendType') == 'Project budget' and d.get('ballpark', False))
        return confirmed, ballpark
    
    def get_current_month_spend(m):
        confirmed = sum(d.get('spend', 0) for d in tracker_data 
                       if d.get('month') == m and d.get('spendType') == 'Project budget' and not d.get('ballpark', False))
        ballpark = sum(d.get('spend', 0) for d in tracker_data 
                      if d.get('month') == m and d.get('spendType') == 'Project budget' and d.get('ballpark', False))
        return confirmed, ballpark
    
    # Build chart bars - previous quarter first, then current quarter
    chart_bars_html = ''
    
    # Previous quarter bars
    for m in prev_quarter_months:
        confirmed_spend, ballpark_spend = get_prev_month_spend(m)
        month_abbrev = m[:3]
        confirmed_pct = (confirmed_spend / chart_max) * 100 if confirmed_spend > 0 else 0
        ballpark_pct = (ballpark_spend / chart_max) * 100 if ballpark_spend > 0 else 0
        ballpark_bottom = confirmed_pct
        
        chart_bars_html += f'''
                        <div class="bar-group">
                            <div class="bar-stack" >
                                <div class="bar-committed" style="height: {committed_pct}%;"></div>
                                <div class="bar-spend" style="height: {confirmed_pct}%;"></div>
                                <div class="bar-ballpark" style="height: {ballpark_pct}%; bottom: {ballpark_bottom}%;"></div>
                            </div>
                            <span class="bar-label">{month_abbrev}</span>
                        </div>'''
    
    # Current quarter bars
    current_month = today.strftime('%B')
    month_order = ['January', 'February', 'March', 'April', 'May', 'June', 
                   'July', 'August', 'September', 'October', 'November', 'December']
    
    for m in quarter_months:
        confirmed_spend, ballpark_spend = get_current_month_spend(m)
        month_abbrev = m[:3]
        confirmed_pct = (confirmed_spend / chart_max) * 100 if confirmed_spend > 0 else 0
        ballpark_pct = (ballpark_spend / chart_max) * 100 if ballpark_spend > 0 else 0
        ballpark_bottom = confirmed_pct
        
        # Check if this month is in the future
        is_future = month_order.index(m) > month_order.index(current_month)
        future_class = ' future' if is_future else ''
        
        chart_bars_html += f'''
                        <div class="bar-group">
                            <div class="bar-stack" >
                                <div class="bar-committed{future_class}" style="height: {committed_pct}%;"></div>
                                <div class="bar-spend" style="height: {confirmed_pct}%;"></div>
                                <div class="bar-ballpark" style="height: {ballpark_pct}%; bottom: {ballpark_bottom}%;"></div>
                            </div>
                            <span class="bar-label">{month_abbrev}</span>
                        </div>'''
    
    # Committed line position
    committed_line_bottom = committed_pct
    
    # Build page 1 project rows
    if has_real_projects:
        page1_rows = ''.join(build_project_row(p, truncate=True) for p in page1_projects)
    else:
        page1_rows = '<tr><td colspan="4" style="text-align: center; color: #999; padding: 20px;">No specific projects this month</td></tr>'
    
    # Build On Us rows (only on_us_items, not extra_budget)
    other_rows = ''.join(build_project_row(p, truncate=True) for p in on_us_items)
    
    # Projects On Us section HTML
    other_stuff_html = ''
    if has_other_stuff:
        other_stuff_html = f'''
        <div class="projects-section">
            <div class="section-title">Projects On Us</div>
            <table class="projects-table">
                <thead>
                    <tr>
                        <th style="width: 35%;">Project</th>
                        <th style="width: 20%;">Owner</th>
                        <th>Description</th>
                        <th style="width: 70px;">Value</th>
                    </tr>
                </thead>
                <tbody>
                    {other_rows}
                </tbody>
            </table>
        </div>
        '''
    
    # More projects indicator
    more_projects_html = '<div class="more-projects">Full list over the page →</div>' if needs_page2 else ''
    
    # Build page 2+ with pagination if needed
    page2_html = ''
    if needs_page2:
        # Pagination: max 12 rows per page
        MAX_ROWS_PER_PAGE = 12
        
        # Build sections to place
        sections_to_place = []  # List of (html, row_count) tuples
        
        # "The Work" section - all projects for this month
        work_row_count = len(real_projects) + 1  # +1 for header
        work_rows = ''.join(build_project_row(p, truncate=False) for p in real_projects)
        work_section = f'''
        <div class="projects-section">
            <div class="section-title">The Work</div>
            <table class="projects-table">
                <thead>
                    <tr>
                        <th style="width: 35%;">Project</th>
                        <th style="width: 20%;">Owner</th>
                        <th>Description</th>
                        <th style="width: 70px;">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    {work_rows}
                </tbody>
            </table>
        </div>'''
        sections_to_place.append((work_section, work_row_count))
        
        # "Projects On Us" section if present
        if has_other_stuff:
            other_row_count = len(on_us_items) + 1  # +1 for header
            other_rows = ''.join(build_project_row(p, truncate=False) for p in on_us_items)
            other_section = f'''
        <div class="projects-section">
            <div class="section-title">Projects On Us</div>
            <table class="projects-table">
                <thead>
                    <tr>
                        <th style="width: 35%;">Project</th>
                        <th style="width: 20%;">Owner</th>
                        <th>Description</th>
                        <th style="width: 70px;">Value</th>
                    </tr>
                </thead>
                <tbody>
                    {other_rows}
                </tbody>
            </table>
        </div>'''
            sections_to_place.append((other_section, other_row_count))
        
        # Distribute sections across pages
        detail_pages = []
        current_page_content = ''
        current_page_rows = 0
        
        for section_html, row_count in sections_to_place:
            if current_page_rows + row_count > MAX_ROWS_PER_PAGE and current_page_rows > 0:
                detail_pages.append(current_page_content)
                current_page_content = ''
                current_page_rows = 0
            
            current_page_content += section_html
            current_page_rows += row_count
        
        if current_page_content:
            detail_pages.append(current_page_content)
        
        # Build all detail pages
        for page_content in detail_pages:
            page2_html += f'''
    <div class="page page-continuation">
        <header class="header">
            <div class="header-left">
                <img src="{get_header_logo_src()}" alt="Tracker" class="header-logo">
            </div>
            <div class="header-right">
                <img src="{get_client_logo_src(client['code'])}" alt="{client['name']}" class="client-logo">
            </div>
        </header>
        
        <div class="report-title-row">
            <div class="client-name">{client['name']}</div>
            <div class="report-meta-block">
                <div class="report-meta">{quarter_label} · {month} {today.year}</div>
            </div>
        </div>
        
        {page_content}
        
        <footer class="footer">
            <div class="footer-left">
                <img src="{get_ai2_logo_src()}" alt="ai²" class="footer-logo">
            </div>
            <div class="footer-tagline">agency intuition × artificial intelligence</div>
            <div class="footer-date">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
                {report_date}
            </div>
        </footer>
    </div>'''

    # Build the head section with CSS (can't use f-string because CSS has curly braces)
    html_head = '''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tracker Report</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap" rel="stylesheet">
    <style>
''' + SHARED_CSS + '''
    </style>
</head>
'''

    # Build the body with f-string
    html_body = f'''<body>
    <div class="page">
        <header class="header">
            <div class="header-left">
                <img src="{get_header_logo_src()}" alt="Tracker" class="header-logo">
            </div>
            <div class="header-right">
                <img src="{get_client_logo_src(client['code'])}" alt="{client['name']}" class="client-logo">
            </div>
        </header>
        
        <div class="report-title-row">
            <div class="client-name">{client['name']}</div>
            <div class="report-meta-block">
                <div class="report-meta">{quarter_label} · {month} {today.year}</div>
            </div>
        </div>
        
        <div class="numbers-section">
            <div class="numbers-grid" style="grid-template-columns: {grid_columns};">
                <div class="stat-box">
                    <div class="stat-value grey">{format_currency(committed)}</div>
                    <div class="stat-label">Committed</div>
                </div>
                <div class="stat-box">
                    <div class="stat-value">{format_currency(grand_total)}</div>
                    <div class="stat-label">To Date</div>
                </div>
                <div class="stat-box">
                    <div class="stat-value {remaining_class}">{format_currency(abs(remaining))}</div>
                    <div class="stat-label">{'Over' if remaining < 0 else 'To Spend'}</div>
                </div>
            </div>
            <div class="progress-bar">
                <div class="progress-fill {progress_class}" style="width: {spend_percent}%;"></div>
            </div>{rollover_line_html}
        </div>
        
        <div class="projects-section">
            <div class="section-title">The Work</div>
            <table class="projects-table">
                <thead>
                    <tr>
                        <th style="width: 35%;">Project</th>
                        <th style="width: 20%;">Owner</th>
                        <th>Description</th>
                        <th style="width: 70px;">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    {page1_rows}
                </tbody>
            </table>
            {more_projects_html}
        </div>
        
        {other_stuff_html}
        
        <div class="bottom-row">
            <div class="chart-section">
                <div class="section-title">Tracker</div>
                <div class="chart-wrapper">
                    <div class="y-axis">
                        {y_axis_html}
                    </div>
                    <div class="chart-container">
                        <div class="committed-line" style="bottom: {committed_line_bottom}%;"></div>
                        {chart_bars_html}
                    </div>
                </div>
                <div class="chart-legend">
                    <div class="legend-item"><div class="legend-swatch spend" style="background: #ED1C24;"></div><span>Projects</span></div>
                    <div class="legend-item"><div class="legend-swatch committed" style="background: #e0e0e0;"></div><span>Committed</span></div>
                    <div class="legend-item"><div class="legend-swatch ballpark" style="background: #ED1C24; opacity: 0.4;"></div><span>Ballpark</span></div>
                </div>
            </div>
            
            <div class="notes-section">
                <div class="section-title">Notes</div>
                <ul class="notes-list">
                    <li><strong>Always on</strong> – This covers ongoing support, consults, and reporting outside specific jobs.</li>
                    <li><strong>Ballparks</strong> – Red numbers are ballparks. Most jobs start as a $5K ballpark before we lock in scope.</li>
                    {rollover_note_html}
                    {extra_budget_note}
                </ul>
            </div>
        </div>
        
        <footer class="footer">
            <div class="footer-left">
                <img src="{get_ai2_logo_src()}" alt="ai²" class="footer-logo">
            </div>
            <div class="footer-tagline">agency intuition × artificial intelligence</div>
            <div class="footer-date">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
                {report_date}
            </div>
        </footer>
    </div>
    
    {page2_html}
</body>
</html>'''
    
    return html_head + html_body


def html_to_pdf(html_content):
    """Convert HTML to PDF using weasyprint or wkhtmltopdf"""
    try:
        # Try weasyprint first
        from weasyprint import HTML
        pdf_bytes = HTML(string=html_content).write_pdf()
        return pdf_bytes
    except ImportError:
        # Fall back to wkhtmltopdf
        with tempfile.NamedTemporaryFile(mode='w', suffix='.html', delete=False) as f:
            f.write(html_content)
            html_path = f.name
        
        pdf_path = html_path.replace('.html', '.pdf')
        
        try:
            subprocess.run([
                'wkhtmltopdf',
                '--enable-local-file-access',
                '--page-size', 'A4',
                '--margin-top', '0',
                '--margin-bottom', '0',
                '--margin-left', '0',
                '--margin-right', '0',
                html_path,
                pdf_path
            ], check=True, capture_output=True)
            
            with open(pdf_path, 'rb') as f:
                pdf_bytes = f.read()
            
            return pdf_bytes
        finally:
            import os
            if os.path.exists(html_path):
                os.remove(html_path)
            if os.path.exists(pdf_path):
                os.remove(pdf_path)


@app.route('/')
def health():
    return jsonify({'status': 'ok', 'service': 'dot-tracker-pdf'})


@app.route('/pdf')
def generate_pdf():
    """Generate tracker PDF"""
    client_code = request.args.get('client', 'TOW')
    month = request.args.get('month', 'January')
    is_quarter = request.args.get('quarter', 'false').lower() == 'true'
    
    # Get data
    client = get_client_data(client_code)
    if not client:
        return jsonify({'error': f'Client {client_code} not found'}), 404
    
    # Get ALL tracker data for this client (no month filter)
    all_tracker_data = get_tracker_data(client_code, None)
    
    # Current quarter months
    quarter_months = get_quarter_months(month)
    all_quarter_data = [r for r in all_tracker_data if r.get('month') in quarter_months]
    
    # Previous quarter months and data (for chart)
    prev_quarter_months = get_previous_quarter_months(quarter_months)
    prev_quarter_data = [r for r in all_tracker_data if r.get('month') in prev_quarter_months]
    
    # For monthly view, also filter to just the selected month for tables
    if is_quarter:
        tracker_data = all_quarter_data
    else:
        tracker_data = [r for r in all_quarter_data if r.get('month') == month]
    
    # Build HTML (pass all_quarter_data and prev_quarter_data for chart)
    html = build_html(client, tracker_data, month, is_quarter, all_quarter_data, prev_quarter_data)
    
    # Convert to PDF
    try:
        pdf_bytes = html_to_pdf(html)
    except Exception as e:
        return jsonify({'error': f'PDF generation failed: {str(e)}'}), 500
    
    # Build filename (sanitize for HTTP headers)
    client_name = client['name'].replace('–', '-').replace('—', '-')  # Replace em/en dashes with hyphens
    if is_quarter:
        quarter_label = get_quarter_label_for_months(quarter_months, client['yearEnd'])
        filename = f"Hunch {quarter_label} Tracker - {client_name}.pdf"
    else:
        month_abbrev = month[:3]
        filename = f"Hunch {month_abbrev} Tracker - {client_name}.pdf"
    
    return Response(
        pdf_bytes,
        mimetype='application/pdf',
        headers={
            'Content-Disposition': f'inline; filename="{filename}"'
        }
    )


@app.route('/html')
def generate_html():
    """Generate tracker HTML (for testing)"""
    client_code = request.args.get('client', 'TOW')
    month = request.args.get('month', 'January')
    is_quarter = request.args.get('quarter', 'false').lower() == 'true'
    
    client = get_client_data(client_code)
    if not client:
        return jsonify({'error': f'Client {client_code} not found'}), 404
    
    # Get ALL tracker data for this client (no month filter)
    all_tracker_data = get_tracker_data(client_code, None)
    
    # Current quarter months
    quarter_months = get_quarter_months(month)
    all_quarter_data = [r for r in all_tracker_data if r.get('month') in quarter_months]
    
    # Previous quarter months and data (for chart)
    prev_quarter_months = get_previous_quarter_months(quarter_months)
    prev_quarter_data = [r for r in all_tracker_data if r.get('month') in prev_quarter_months]
    
    # For monthly view, also filter to just the selected month for tables
    if is_quarter:
        tracker_data = all_quarter_data
    else:
        tracker_data = [r for r in all_quarter_data if r.get('month') == month]
    
    html = build_html(client, tracker_data, month, is_quarter, all_quarter_data, prev_quarter_data)
    
    return Response(html, mimetype='text/html')


# ===== WIP PDF FUNCTIONS =====

def get_wip_jobs(client_code):
    """Fetch active jobs from Hub API"""
    try:
        response = requests.get(f"{API_BASE}/jobs/all", params={
            'client': client_code,
            'status': 'active'
        })
        if response.status_code == 200:
            return response.json()
    except Exception as e:
        print(f"Error fetching WIP jobs: {e}")
    return []


def group_wip_jobs(jobs):
    """Group jobs into WIP sections"""
    groups = {
        'withUs': [],
        'withClient': [],
        'incoming': [],
        'onHold': []
    }
    
    for job in jobs:
        status = job.get('status', '')
        with_client = job.get('withClient', False)
        
        # Skip finance jobs (still visible in Tracker)
        job_num = job.get('jobNumber', '')
        num = job_num.split(' ')[1] if ' ' in job_num else ''
        if num in ('000', '001', '998', '999'):
            continue
        
        if status == 'Incoming':
            groups['incoming'].append(job)
        elif status == 'On Hold':
            groups['onHold'].append(job)
        elif with_client:
            groups['withClient'].append(job)
        else:
            groups['withUs'].append(job)
    
    # Sort each group by updateDue
    for key in groups:
        groups[key].sort(key=lambda j: j.get('updateDue', '') or '9999-99-99')
    
    return groups


def format_wip_date(date_str):
    """Format date for WIP display (e.g., '2026-01-15' -> '15 Jan'). Past dates render as 'TBC' for client-facing PDF."""
    if not date_str:
        return 'TBC'
    try:
        dt = datetime.strptime(date_str, '%Y-%m-%d')
        if dt.date() < datetime.now().date():
            return 'TBC'
        return dt.strftime('%-d %b')
    except:
        return date_str


def truncate_text(text, max_len=60):
    """Truncate text with ellipsis"""
    if not text:
        return '-'
    if len(text) <= max_len:
        return text
    return text[:max_len-3] + '...'


def build_wip_section_rows(jobs, max_rows=None):
    """Build table rows for a WIP section"""
    if not jobs:
        return '<tr><td colspan="4" style="color: #999; font-style: italic; padding: 12px 0;">No jobs</td></tr>'
    
    rows = []
    job_list = jobs[:max_rows] if max_rows else jobs
    
    for job in job_list:
        job_number = job.get('jobNumber', '')
        job_name = job.get('jobName', '')
        update = job.get('update', '') or '-'
        due = format_wip_date(job.get('updateDue', ''))
        
        rows.append(f'''
            <tr>
                <td class="job-id">{job_number}</td>
                <td class="job-name">{job_name}</td>
                <td class="job-update">{update}</td>
                <td class="job-due">{due}</td>
            </tr>
        ''')
    
    if max_rows and len(jobs) > max_rows:
        remaining = len(jobs) - max_rows
        rows.append(f'<tr><td colspan="4" class="more-jobs">+ {remaining} more</td></tr>')
    
    return '\n'.join(rows)


def build_wip_html(client, jobs):
    """Build HTML for WIP PDF - full width stacked layout"""
    groups = group_wip_jobs(jobs)
    report_date = datetime.now().strftime('%-d %B %Y')
    
    # Empty state messages
    empty_messages = {
        'withUs': 'All jobs with you right now.',
        'withClient': 'Nothing with you right now.',
        'incoming': 'Nothing in the incoming list.',
        'onHold': 'Nothing on hold.'
    }
    
    def build_section_content(group_key, jobs_list, max_rows=10):
        if not jobs_list:
            return f'<div class="empty-message">{empty_messages[group_key]}</div>'
        return f'''<table class="wip-table">
                <thead>
                    <tr>
                        <th>Job</th>
                        <th>Name</th>
                        <th>Update</th>
                        <th style="text-align: right;">Due</th>
                    </tr>
                </thead>
                <tbody>
                    {build_wip_section_rows(jobs_list, max_rows=max_rows)}
                </tbody>
            </table>'''
    
    html = f'''<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        {SHARED_CSS}
        
        /* WIP-specific styles - full width stacked */
        .wip-logo-row {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
        }}
        
        .wip-header-image img {{
            height: 50px;
            width: auto;
        }}
        
        .wip-client-logo img {{
            height: 50px;
            width: auto;
            object-fit: contain;
        }}
        
        .wip-header-row {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }}
        
        .wip-eyebrow {{
            font-size: 11px;
            font-weight: 400;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            color: #999;
        }}
        
        .wip-date {{
            font-size: 11px;
            font-weight: 400;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            color: #999;
            display: inline-flex;
            align-items: center;
            gap: 5px;
            white-space: nowrap;
            flex-shrink: 0;
        }}
        
        .wip-date svg {{
            flex-shrink: 0;
        }}
        
        /* Override footer date for WIP - smaller */
        .footer .footer-date {{
            font-size: 9px;
        }}
        
        .wip-section {{
            border: 1px solid #e5e5e5;
            border-radius: 8px;
            padding: 14px 16px;
            margin-bottom: 12px;
            background: #fafafa;
        }}
        
        .wip-section:last-of-type {{
            margin-bottom: 0;
        }}
        
        .wip-section-title {{
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            color: #ED1C24;
            margin-bottom: 10px;
            padding-bottom: 6px;
            border-bottom: 2px solid #ED1C24;
        }}
        
        .wip-table {{
            width: 100%;
            border-collapse: collapse;
            font-size: 9px;
        }}
        
        .wip-table th {{
            text-align: left;
            font-size: 8px;
            font-weight: 600;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            padding: 5px 8px 5px 0;
            border-bottom: 1px solid #ED1C24;
        }}
        
        .wip-table td {{
            padding: 6px 8px 6px 0;
            color: #333;
            vertical-align: top;
            border-bottom: 1px solid #e5e5e5;
        }}
        
        .wip-table tr:last-child td {{
            border-bottom: none;
        }}
        
        .job-id {{
            font-weight: 600;
            color: #333;
            white-space: nowrap;
            width: 70px;
        }}
        
        .job-name {{
            font-weight: 500;
            color: #333;
            width: 160px;
        }}
        
        .job-update {{
            color: #555;
            font-size: 8px;
        }}
        
        .job-due {{
            text-align: right;
            white-space: nowrap;
            color: #666;
            width: 50px;
            padding-right: 0 !important;
        }}
        
        .more-jobs {{
            color: #999;
            font-style: italic;
            text-align: center;
            padding-top: 6px;
        }}
        
        .empty-message {{
            color: #999;
            font-style: italic;
            font-size: 10px;
            padding: 4px 0;
        }}
    </style>
</head>
<body>
    <div class="page">
        <div class="wip-logo-row">
            <div class="wip-header-image">
                <img src="{get_wip_header_src()}" alt="Hunch WIP">
            </div>
            <div class="wip-client-logo">
                <img src="{get_client_logo_src(client['code'])}" alt="{client['name']}">
            </div>
        </div>
        
        <div class="wip-header-row">
            <div class="wip-eyebrow">Work in Progress</div>
            <div class="wip-date">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
                {report_date}
            </div>
        </div>
        
        <div class="wip-section">
            <div class="wip-section-title">Jobs With Us</div>
            {build_section_content('withUs', groups['withUs'], max_rows=10)}
        </div>
        
        <div class="wip-section">
            <div class="wip-section-title">Jobs With You</div>
            {build_section_content('withClient', groups['withClient'], max_rows=10)}
        </div>
        
        <div class="wip-section">
            <div class="wip-section-title">Incoming Jobs</div>
            {build_section_content('incoming', groups['incoming'], max_rows=6)}
        </div>
        
        <div class="wip-section">
            <div class="wip-section-title">Jobs On Hold</div>
            {build_section_content('onHold', groups['onHold'], max_rows=6)}
        </div>
        
        <footer class="footer">
            <div class="footer-left">
                <img src="{get_ai2_logo_src()}" alt="ai2" class="footer-logo">
            </div>
            <div class="footer-tagline">agency intuition x artificial intelligence</div>
            <div class="footer-date">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
                {report_date}
            </div>
        </footer>
    </div>
</body>
</html>'''
    
    return html


@app.route('/wip')
def generate_wip_pdf():
    """Generate WIP PDF for a client"""
    client_code = request.args.get('client', 'TOW')
    
    # Get client data
    client = get_client_data(client_code)
    if not client:
        return jsonify({'error': f'Client {client_code} not found'}), 404
    
    # Get active jobs
    jobs = get_wip_jobs(client_code)
    
    # Build HTML
    html = build_wip_html(client, jobs)
    
    # Convert to PDF
    try:
        pdf_bytes = html_to_pdf(html)
    except Exception as e:
        return jsonify({'error': f'PDF generation failed: {str(e)}'}), 500
    
    # Build filename
    client_name = client['name'].replace('–', '-').replace('—', '-')
    date_str = datetime.now().strftime('%Y-%m-%d')
    filename = f"Hunch WIP - {client_name} - {date_str}.pdf"
    
    return Response(
        pdf_bytes,
        mimetype='application/pdf',
        headers={
            'Content-Disposition': f'inline; filename="{filename}"'
        }
    )


@app.route('/wip-html')
def generate_wip_html():
    """Generate WIP HTML (for testing)"""
    client_code = request.args.get('client', 'TOW')
    
    client = get_client_data(client_code)
    if not client:
        return jsonify({'error': f'Client {client_code} not found'}), 404
    
    jobs = get_wip_jobs(client_code)
    html = build_wip_html(client, jobs)
    
    return Response(html, mimetype='text/html')


if __name__ == '__main__':
    app.run(debug=True, port=5000)
