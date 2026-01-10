from flask import Flask, request, Response, jsonify, send_from_directory
from flask_cors import CORS
import requests
import os
from datetime import datetime
import subprocess
import tempfile

app = Flask(__name__, static_folder='static')
CORS(app)

# Use dot-remote-api for data (it handles all the Airtable lookups)
API_BASE = 'https://dot-remote-api.up.railway.app'

# Get the base URL for this service (for static files)
SERVICE_URL = os.environ.get('RAILWAY_PUBLIC_DOMAIN', 'dot-tracker-pdf.up.railway.app')
IMAGE_BASE = f'https://{SERVICE_URL}/static/images'

# Load shared CSS once at startup
CSS_PATH = os.path.join(os.path.dirname(__file__), 'static', 'css', 'report.css')
try:
    with open(CSS_PATH, 'r') as f:
        SHARED_CSS = f.read()
except FileNotFoundError:
    SHARED_CSS = '/* CSS file not found */'


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
                    return {
                        'name': c.get('name', client_code),
                        'code': client_code,
                        'monthlyCommitted': c.get('committed', 10000),
                        'rolloverCredit': c.get('rollover', 0) or 0,
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
    """For quarterly view, add month prefix to descriptions but keep individual rows"""
    
    result = []
    for record in tracker_data:
        month = record.get('month', '')
        month_abbrev = month[:3] if month else ''  # Jan, Feb, etc.
        description = record.get('description', '')
        
        # Add month prefix to description
        if month_abbrev and description:
            prefixed_description = f"{month_abbrev}: {description}"
        elif month_abbrev:
            prefixed_description = month_abbrev
        else:
            prefixed_description = description
        
        result.append({
            'jobNumber': record.get('jobNumber', ''),
            'projectName': record.get('projectName', ''),
            'owner': record.get('owner', ''),
            'description': prefixed_description,
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
    
    display_amount = '$0' if project['onUs'] else format_currency_full(project['spend'])
    
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
        }
    
    for record in tracker_data:
        if record['spendType'] == 'Project budget':
            m = record.get('month', '')
            if m in summary:
                spend = record.get('spend', 0) or 0
                job_number = record.get('jobNumber', '')
                
                summary[m]['total_spend'] += spend
                
                # Check if it's a 000 job (retainer)
                if ' 000' not in job_number:
                    summary[m]['key_project_count'] += 1
                    summary[m]['key_project_spend'] += spend
    
    return summary


def build_other_stuff_summary(tracker_data):
    """Build other stuff summary for quarterly report front page"""
    extra_budget = {'count': 0, 'spend': 0}
    on_us = {'count': 0, 'spend': 0}
    
    for record in tracker_data:
        spend_type = record.get('spendType', '')
        spend = record.get('spend', 0) or 0
        
        if spend_type == 'Extra budget':
            extra_budget['count'] += 1
            extra_budget['spend'] += spend
        elif spend_type == 'Project on us':
            on_us['count'] += 1
            # On us shows $0
    
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


def build_html(client, tracker_data, month, is_quarter=False):
    """Build the complete HTML document"""
    
    # Determine quarter info
    quarter_months = get_quarter_months(month)
    display_quarter_label = get_quarter_label_for_months(quarter_months, client['yearEnd'])
    
    # If quarterly view, add month prefix to descriptions (for back page)
    if is_quarter:
        tracker_data = aggregate_quarterly_data(tracker_data)
    
    # Separate projects from other stuff
    projects = [r for r in tracker_data if r['spendType'] == 'Project budget']
    other_stuff = [r for r in tracker_data if r['spendType'] != 'Project budget']
    
    # Sort by spend (highest first) for monthly view
    projects.sort(key=lambda x: x['spend'] or 0, reverse=True)
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
    if is_quarter:
        # For quarterly, check if rolloverUseIn matches the quarter label
        rollover_applies = (rollover_use_in == display_quarter_label)
    else:
        # For monthly, check if the month is in the rollover quarter
        rollover_applies = (rollover_use_in == display_quarter_label)
    
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
    
    # Rollover box and note
    rollover_box_html = ''
    if rollover > 0:
        rollover_box_html = f'''
                <div class="stat-box rollover-box">
                    <div class="stat-value grey">+{format_currency(rollover)}</div>
                    <div class="stat-label">{rollover_quarter} Rollover</div>
                </div>'''
        rollover_note_html = '<li><strong>Rollover</strong> – You can use your rollover credit any time during the quarter. It\'s extra on top of committed spend.</li>'
    else:
        rollover_note_html = '<li><strong>Rollover</strong> – Remember, if you don\'t use all your committed spend, it will roll over for the team to use next quarter.</li>'
    
    # Grid columns - 3 if no rollover, 4 if rollover
    grid_columns = 'repeat(4, 1fr)' if rollover > 0 else 'repeat(3, 1fr)'
    
    # Build quarterly or monthly specific content
    if is_quarter:
        return build_quarterly_html(
            client, tracker_data, projects, other_stuff, quarter_months,
            committed, grand_total, remaining, rollover, rollover_quarter,
            spend_percent, is_overspent, remaining_class, progress_class,
            rollover_box_html, rollover_note_html, grid_columns,
            quarter_label, quarter_range, report_date_short, today, display_quarter_label
        )
    else:
        return build_monthly_html(
            client, tracker_data, projects, other_stuff, month,
            committed, grand_total, remaining, rollover, rollover_quarter,
            spend_percent, is_overspent, remaining_class, progress_class,
            rollover_box_html, rollover_note_html, grid_columns,
            quarter_label, report_date_short, today
        )


def build_quarterly_html(client, tracker_data, projects, other_stuff, quarter_months,
                         committed, grand_total, remaining, rollover, rollover_quarter,
                         spend_percent, is_overspent, remaining_class, progress_class,
                         rollover_box_html, rollover_note_html, grid_columns,
                         quarter_label, quarter_range, report_date, today, display_quarter_label):
    """Build HTML for quarterly report (2 pages: summary + detail)"""
    
    # Build monthly summary for front page
    monthly_summary = build_monthly_summary(tracker_data, quarter_months)
    
    # Build other stuff summary
    other_summary = build_other_stuff_summary(tracker_data)
    has_other_stuff = other_summary['extra_budget']['count'] > 0 or other_summary['on_us']['count'] > 0
    
    # Build chart data - spend per month (monthly committed, not quarterly)
    monthly_committed = committed // 3  # Monthly budget
    chart_max = monthly_committed + 5000  # Y-axis max
    
    chart_bars_html = ''
    for m in quarter_months:
        month_spend = monthly_summary[m]['total_spend']
        month_abbrev = m[:3]
        
        # Calculate bar heights as percentages of chart height
        committed_height = (monthly_committed / chart_max) * 100
        spend_height = (month_spend / chart_max) * 100 if month_spend > 0 else 0
        
        chart_bars_html += f'''
            <div class="bar-group">
                <div class="bar-stack" style="height: 100px;">
                    <div class="bar-committed" style="height: {committed_height}%;"></div>
                    <div class="bar-spend" style="height: {spend_height}%;"></div>
                </div>
                <span class="bar-label">{month_abbrev}</span>
            </div>'''
    
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
        
        # Build "We worked on" description
        if key_count == 0:
            if month_spend > 0:
                worked_on = "Retainer only"
            else:
                worked_on = "Nothing from you this month"
        elif key_count == 1:
            avg = round_to_hundred(key_spend)
            worked_on = f"1 key project ({format_currency(avg)})"
        else:
            avg = round_to_hundred(key_spend / key_count) if key_count > 0 else 0
            worked_on = f"{key_count} key projects (avg {format_currency(avg)})"
        
        summary_rows += f'''
            <tr>
                <td>{m}</td>
                <td>{worked_on}</td>
                <td style="text-align: right;">{format_currency(month_spend)}</td>
            </tr>'''
    
    # Quarter total row
    total_spend_rounded = round_to_hundred(total_spend)
    if total_key_projects == 0:
        total_worked_on = "Retainer only"
    else:
        total_avg = round_to_hundred(total_key_spend / total_key_projects) if total_key_projects > 0 else 0
        total_worked_on = f"{total_key_projects} projects (avg {format_currency(total_avg)})"
    
    summary_rows += f'''
        <tr class="total-row">
            <td><strong>{quarter_label} {today.year}</strong></td>
            <td><strong>{total_worked_on}</strong></td>
            <td style="text-align: right;"><strong>{format_currency(total_spend_rounded)}</strong></td>
        </tr>'''
    
    # Build other stuff summary table
    other_stuff_html = ''
    if has_other_stuff:
        other_rows = ''
        if other_summary['extra_budget']['count'] > 0:
            other_rows += f'''
                <tr>
                    <td>Extra budget</td>
                    <td style="text-align: center;">{other_summary['extra_budget']['count']}</td>
                    <td style="text-align: right;">{format_currency_full(other_summary['extra_budget']['spend'])}</td>
                </tr>'''
        if other_summary['on_us']['count'] > 0:
            other_rows += f'''
                <tr>
                    <td>On us</td>
                    <td style="text-align: center;">{other_summary['on_us']['count']}</td>
                    <td style="text-align: right;">$0</td>
                </tr>'''
        
        other_stuff_html = f'''
        <div class="projects-section">
            <div class="section-title">Other Stuff</div>
            <table class="summary-table">
                <thead>
                    <tr>
                        <th>Type</th>
                        <th style="text-align: center;">Projects</th>
                        <th style="text-align: right;">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    {other_rows}
                </tbody>
            </table>
        </div>'''
    
    # Build monthly detail sections for back page
    monthly_detail = build_monthly_detail_sections(tracker_data, quarter_months)
    
    detail_sections = ''
    for m in quarter_months:
        month_projects = monthly_detail[m]
        if not month_projects:
            continue
        
        month_total = sum(p.get('spend', 0) or 0 for p in month_projects)
        
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
        
        detail_sections += f'''
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
                        <td colspan="3"><strong>{m} Total</strong></td>
                        <td class="amount"><strong>{format_currency_full(month_total)}</strong></td>
                    </tr>
                </tbody>
            </table>
        </div>'''
    
    # Build other stuff detail for back page
    other_detail_html = ''
    if has_other_stuff:
        other_items = [r for r in tracker_data if r['spendType'] != 'Project budget']
        if other_items:
            other_rows = ''
            for p in other_items:
                display_amount = '$0' if p.get('onUs') else format_currency_full(p.get('spend', 0))
                ballpark_class = ' ballpark' if p.get('ballpark') else ''
                other_rows += f'''
                    <tr>
                        <td class="project-name">{p['jobNumber']} · {p['projectName']}</td>
                        <td>{p.get('owner', '')}</td>
                        <td class="description">{p.get('description', '')}</td>
                        <td class="amount{ballpark_class}">{display_amount}</td>
                    </tr>'''
            
            other_detail_html = f'''
            <div class="projects-section">
                <div class="section-title">Other Stuff</div>
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
                        {other_rows}
                    </tbody>
                </table>
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
    
    # Build the body with f-string (no CSS curly brace conflicts)
    html_body = f'''<body>
    <!-- Page 1: Summary -->
    <div class="page">
        <header class="header">
            <div class="header-left">
                <img src="{IMAGE_BASE}/tracker-header.png" alt="Tracker" class="header-logo">
            </div>
            <div class="header-right">
                <img src="{IMAGE_BASE}/{client['code']}.png" alt="{client['name']}" class="client-logo">
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
                </div>{rollover_box_html}
            </div>
            <div class="progress-bar">
                <div class="progress-fill {progress_class}" style="width: {spend_percent}%;"></div>
            </div>
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
                    <div class="committed-line"></div>
                    <div class="chart-container">
                        {chart_bars_html}
                    </div>
                </div>
                <div class="chart-legend">
                    <div class="legend-item"><div class="legend-swatch spend"></div><span>Spend</span></div>
                    <div class="legend-item"><div class="legend-swatch committed-swatch"></div><span>Committed</span></div>
                </div>
            </div>
            
            <div class="notes-section">
                <div class="section-title">Notes</div>
                <ul class="notes-list">
                    <li><strong>Ballparks</strong> – Red amounts are estimates, not locked in yet.</li>
                    {rollover_note_html}
                    <li><strong>Always on</strong> – Includes 10% for meetings and ad-hoc consults.</li>
                </ul>
            </div>
        </div>
        
        <footer class="footer">
            <div class="footer-left">
                <img src="{IMAGE_BASE}/dot-ai2-logo.png" alt="ai²" class="footer-logo">
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
                <img src="{IMAGE_BASE}/tracker-header.png" alt="Tracker" class="header-logo">
            </div>
            <div class="header-right">
                <img src="{IMAGE_BASE}/{client['code']}.png" alt="{client['name']}" class="client-logo">
            </div>
        </header>
        
        <div class="page-2-header">{client['name']} · {quarter_label} Detail</div>
        
        {detail_sections}
        
        {other_detail_html}
        
        <footer class="footer">
            <div class="footer-left">
                <img src="{IMAGE_BASE}/dot-ai2-logo.png" alt="ai²" class="footer-logo">
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
    
    return html_head + html_body


def build_monthly_html(client, tracker_data, projects, other_stuff, month,
                       committed, grand_total, remaining, rollover, rollover_quarter,
                       spend_percent, is_overspent, remaining_class, progress_class,
                       rollover_box_html, rollover_note_html, grid_columns,
                       quarter_label, report_date, today):
    """Build HTML for monthly report (original single-page layout)"""
    
    has_other_stuff = len(other_stuff) > 0
    max_page1_projects = 4 if has_other_stuff else 7
    page1_projects = projects[:max_page1_projects]
    page2_projects = projects[max_page1_projects:]
    needs_page2 = len(page2_projects) > 0
    
    # Build page 1 project rows
    page1_rows = ''.join(build_project_row(p, truncate=True) for p in page1_projects)
    
    # Build other stuff rows
    other_rows = ''.join(build_project_row(p, truncate=True) for p in other_stuff)
    
    # Other stuff section HTML
    other_stuff_html = ''
    if has_other_stuff:
        other_stuff_html = f'''
        <div class="projects-section">
            <div class="section-title">Other Stuff</div>
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
                    {other_rows}
                </tbody>
            </table>
        </div>
        '''
    
    # More projects indicator
    more_projects_html = '<div class="more-projects">Full list over the page →</div>' if needs_page2 else ''
    
    # Build page 2 if needed
    page2_html = ''
    if needs_page2:
        page2_project_rows = ''.join(build_project_row(p, truncate=False) for p in projects)
        page2_other_rows = ''.join(build_project_row(p, truncate=False) for p in other_stuff)
        
        page2_other_html = ''
        if has_other_stuff:
            page2_other_html = f'''
            <div class="projects-section">
                <div class="section-title">Other Stuff</div>
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
                        {page2_other_rows}
                    </tbody>
                </table>
            </div>
            '''
        
        page2_html = f'''
    <div class="page page-continuation">
        <header class="header">
            <div class="header-left">
                <img src="{IMAGE_BASE}/tracker-header.png" alt="Tracker" class="header-logo">
            </div>
            <div class="header-right">
                <img src="{IMAGE_BASE}/{client['code']}.png" alt="{client['name']}" class="client-logo">
            </div>
        </header>
        
        <div class="report-title-row">
            <div class="client-name">{client['name']}</div>
            <div class="report-meta-block">
                <div class="report-meta">{quarter_label} · {month} {today.year}</div>
            </div>
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
                    {page2_project_rows}
                </tbody>
            </table>
        </div>
        
        {page2_other_html}
        
        <footer class="footer">
            <div class="footer-left">
                <img src="{IMAGE_BASE}/dot-ai2-logo.png" alt="ai²" class="footer-logo">
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
        '''

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
                <img src="{IMAGE_BASE}/tracker-header.png" alt="Tracker" class="header-logo">
            </div>
            <div class="header-right">
                <img src="{IMAGE_BASE}/{client['code']}.png" alt="{client['name']}" class="client-logo">
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
                </div>
                <div class="stat-box">
                    <div class="stat-value {remaining_class}">{format_currency(abs(remaining))}</div>
                    <div class="stat-label">{'Over' if remaining < 0 else 'To Spend'}</div>
                </div>{rollover_box_html}
            </div>
            <div class="progress-bar">
                <div class="progress-fill {progress_class}" style="width: {spend_percent}%;"></div>
            </div>
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
        
        <div class="two-col">
            <div class="chart-section">
                <div class="section-title">Tracker</div>
                <div class="chart-wrapper">
                    <div class="y-axis">
                        <span class="y-label">$20k</span>
                        <span class="y-label">$15k</span>
                        <span class="y-label">$10k</span>
                        <span class="y-label">$5k</span>
                        <span class="y-label">$0</span>
                    </div>
                    <div class="committed-line" style="bottom: 50%;"></div>
                    <div class="chart-container">
                        <div class="bar-group">
                            <div class="bar-stack" style="height: 80px;">
                                <div class="bar-committed" style="height: 100%;"></div>
                                <div class="bar-spend" style="height: 45%;"></div>
                            </div>
                            <span class="bar-label">Oct</span>
                        </div>
                        <div class="bar-group">
                            <div class="bar-stack" style="height: 80px;">
                                <div class="bar-committed" style="height: 100%;"></div>
                                <div class="bar-spend" style="height: 52%;"></div>
                            </div>
                            <span class="bar-label">Nov</span>
                        </div>
                        <div class="bar-group">
                            <div class="bar-stack" style="height: 80px;">
                                <div class="bar-committed" style="height: 100%;"></div>
                                <div class="bar-spend" style="height: 48%;"></div>
                            </div>
                            <span class="bar-label">Dec</span>
                        </div>
                        <div class="bar-group">
                            <div class="bar-stack" style="height: 80px;">
                                <div class="bar-committed" style="height: 100%;"></div>
                                <div class="bar-spend" style="height: 60%;"></div>
                            </div>
                            <span class="bar-label">Jan</span>
                        </div>
                        <div class="bar-group">
                            <div class="bar-stack" style="height: 80px;">
                                <div class="bar-committed" style="height: 100%; opacity: 0.5;"></div>
                            </div>
                            <span class="bar-label">Feb</span>
                        </div>
                        <div class="bar-group">
                            <div class="bar-stack" style="height: 80px;">
                                <div class="bar-committed" style="height: 100%; opacity: 0.5;"></div>
                            </div>
                            <span class="bar-label">Mar</span>
                        </div>
                    </div>
                </div>
                <div class="chart-legend">
                    <div class="legend-item"><div class="legend-swatch spend"></div><span>Spend</span></div>
                    <div class="legend-item"><div class="legend-swatch committed"></div><span>Committed</span></div>
                </div>
            </div>
            
            <div class="notes-section">
                <div class="section-title">Notes</div>
                <ul class="notes-list">
                    <li><strong>Ballparks</strong> – Red amounts are estimates, not locked in yet.</li>
                    {rollover_note_html}
                    <li><strong>Always on</strong> – Includes 10% for meetings and ad-hoc consults.</li>
                </ul>
            </div>
        </div>
        
        <footer class="footer">
            <div class="footer-left">
                <img src="{IMAGE_BASE}/dot-ai2-logo.png" alt="ai²" class="footer-logo">
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
    
    # For quarterly view, get all data then filter by quarter months
    if is_quarter:
        tracker_data = get_tracker_data(client_code, None)
        quarter_months = get_quarter_months(month)
        tracker_data = [r for r in tracker_data if r.get('month') in quarter_months]
    else:
        tracker_data = get_tracker_data(client_code, month)
    
    # Build HTML
    html = build_html(client, tracker_data, month, is_quarter)
    
    # Convert to PDF
    try:
        pdf_bytes = html_to_pdf(html)
    except Exception as e:
        return jsonify({'error': f'PDF generation failed: {str(e)}'}), 500
    
    # Return PDF
    filename = f"Tracker-{client_code}-{month}.pdf"
    
    return Response(
        pdf_bytes,
        mimetype='application/pdf',
        headers={
            'Content-Disposition': f'attachment; filename="{filename}"'
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
    
    # For quarterly view, get all data then filter by quarter months
    if is_quarter:
        tracker_data = get_tracker_data(client_code, None)
        quarter_months = get_quarter_months(month)
        tracker_data = [r for r in tracker_data if r.get('month') in quarter_months]
    else:
        tracker_data = get_tracker_data(client_code, month)
    
    html = build_html(client, tracker_data, month, is_quarter)
    
    return Response(html, mimetype='text/html')


if __name__ == '__main__':
    app.run(debug=True, port=5000)
