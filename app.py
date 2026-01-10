from flask import Flask, request, Response, jsonify
from flask_cors import CORS
import requests
import os
from datetime import datetime
import subprocess
import tempfile

app = Flask(__name__)
CORS(app)

# Airtable config
AIRTABLE_API_KEY = os.environ.get('AIRTABLE_API_KEY')
AIRTABLE_BASE_ID = os.environ.get('AIRTABLE_BASE_ID', 'app8CI7NAZqhQ4G1Y')

HEADERS = {
    'Authorization': f'Bearer {AIRTABLE_API_KEY}',
    'Content-Type': 'application/json'
}

# Image base URL (GitHub Pages)
IMAGE_BASE = 'https://hunchee.github.io/dot-images'


def get_client_data(client_code):
    """Fetch client info from Airtable"""
    url = f"https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/Clients"
    params = {'filterByFormula': f'{{Client Code}}="{client_code}"'}
    
    response = requests.get(url, headers=HEADERS, params=params)
    if response.status_code == 200:
        records = response.json().get('records', [])
        if records:
            fields = records[0].get('fields', {})
            
            # Helper to extract value (handles lists from linked records)
            def get_val(field_name, default=None):
                val = fields.get(field_name, default)
                if isinstance(val, list):
                    return val[0] if val else default
                return val
            
            return {
                'name': get_val('Client', client_code),
                'code': client_code,
                'monthlyCommitted': get_val('Monthly Committed', 10000),
                'rolloverCredit': get_val('Rollover Credit', 0) or 0,
                'rolloverQuarter': f"Q{get_val('Rollover', 1) or 1}",
                'currentQuarter': get_val('Current Quarter', 'Q1'),
                'yearEnd': get_val('Year end', 'March')
            }
    return None


def get_projects_for_client(client_code):
    """Fetch all projects for a client from Airtable"""
    url = f"https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/Projects"
    
    # Client code is the prefix of Job Number (e.g., "TOW" in "TOW 087")
    formula = f'SEARCH("{client_code}", {{Job Number}})'
    
    params = {'filterByFormula': formula}
    
    all_records = []
    offset = None
    
    while True:
        if offset:
            params['offset'] = offset
        
        response = requests.get(url, headers=HEADERS, params=params)
        if response.status_code == 200:
            data = response.json()
            all_records.extend(data.get('records', []))
            offset = data.get('offset')
            if not offset:
                break
        else:
            break
    
    # Return as dict keyed by Job Number for easy lookup
    result = {}
    for r in all_records:
        job_num = r['fields'].get('Job Number', '')
        # Handle if Job Number is a list (linked record) or string
        if isinstance(job_num, list):
            job_num = job_num[0] if job_num else ''
        result[job_num] = {
            'projectName': r['fields'].get('Project Name', ''),
            'owner': r['fields'].get('Project Owner', ''),
            'description': r['fields'].get('Description', ''),
        }
    return result


def get_tracker_data(client_code, month=None):
    """Fetch tracker records from Airtable and join with Projects"""
    
    # First get all projects for this client (for the join)
    projects_lookup = get_projects_for_client(client_code)
    
    # Now get tracker records
    url = f"https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/Tracker"
    
    if month:
        formula = f'AND({{Client Code}}="{client_code}", {{Month}}="{month}")'
    else:
        formula = f'{{Client Code}}="{client_code}"'
    
    params = {
        'filterByFormula': formula,
        'sort[0][field]': 'Spend',
        'sort[0][direction]': 'desc'
    }
    
    response = requests.get(url, headers=HEADERS, params=params)
    if response.status_code == 200:
        records = response.json().get('records', [])
        result = []
        
        for r in records:
            job_number = r['fields'].get('Job Number', '')
            # Handle if Job Number is a list (linked record) or string
            if isinstance(job_number, list):
                job_number = job_number[0] if job_number else ''
            project = projects_lookup.get(job_number, {})
            
            result.append({
                'jobNumber': job_number,
                # Use Tracker's Project Name if set, otherwise fall back to Projects
                'projectName': r['fields'].get('Project Name') or project.get('projectName', ''),
                # Owner comes from Projects table (Project Owner field)
                'owner': project.get('owner', ''),
                # Description comes from Projects table
                'description': project.get('description', ''),
                'spend': r['fields'].get('Spend', 0),
                'spendType': r['fields'].get('Spend type', 'Project budget'),
                'ballpark': r['fields'].get('Ballpark', False),
                'onUs': r['fields'].get('On us', False),
                'month': r['fields'].get('Month', '')
            })
        
        return result
    return []


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


def build_html(client, tracker_data, month, is_quarter=False):
    """Build the complete HTML document"""
    
    # Separate projects from other stuff
    projects = [r for r in tracker_data if r['spendType'] == 'Project budget']
    other_stuff = [r for r in tracker_data if r['spendType'] != 'Project budget']
    
    # Sort by spend (highest first)
    projects.sort(key=lambda x: x['spend'] or 0, reverse=True)
    other_stuff.sort(key=lambda x: x['spend'] or 0, reverse=True)
    
    # Calculate totals
    projects_total = sum(p['spend'] or 0 for p in projects)
    other_total = sum(p['spend'] or 0 for p in other_stuff if not p['onUs'])
    grand_total = projects_total + other_total
    
    # Get client numbers
    committed = client['monthlyCommitted']
    rollover = client['rolloverCredit']
    rollover_quarter = client['rolloverQuarter']
    available = committed + rollover
    remaining = available - grand_total
    spend_percent = min(100, round((grand_total / available) * 100)) if available > 0 else 0
    
    # Pagination rules
    has_other_stuff = len(other_stuff) > 0
    max_page1_projects = 4 if has_other_stuff else 7
    page1_projects = projects[:max_page1_projects]
    page2_projects = projects[max_page1_projects:]
    needs_page2 = len(page2_projects) > 0
    
    # Format dates
    today = datetime.now()
    report_date = today.strftime('%d %b')
    quarter_label = client['currentQuarter']
    
    # Determine remaining color
    remaining_class = 'red' if remaining < 0 else ''
    
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
                <img src="{IMAGE_BASE}/logos/{client['code']}.png" alt="{client['name']}" class="client-logo">
            </div>
        </header>
        
        <div class="report-title-row">
            <div class="client-name">{client['name']}</div>
            <div class="report-meta-block">
                <div class="report-meta">{quarter_label} · {month} {today.year}</div>
                <div class="report-date">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="2">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                    {report_date}
                </div>
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
        </footer>
    </div>
        '''
    
    # Full HTML
    html = f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tracker Report - {client['name']}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap" rel="stylesheet">
    <style>
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        
        @page {{ size: A4; margin: 0; }}
        
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: white;
            color: #333;
            line-height: 1.4;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }}
        
        .page {{
            width: 210mm;
            min-height: 297mm;
            padding: 20mm 20mm 15mm 20mm;
            margin: 0 auto;
            background: white;
            position: relative;
        }}
        
        .header {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding-bottom: 16px;
            border-bottom: 3px solid #ED1C24;
            margin-bottom: 16px;
        }}
        
        .header-left {{ display: flex; align-items: center; }}
        .header-logo {{ height: 40px; width: auto; }}
        .header-right {{ display: flex; align-items: center; }}
        .client-logo {{ height: 40px; width: 40px; border-radius: 50%; object-fit: cover; }}
        
        .report-title-row {{
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 20px;
        }}
        
        .client-name {{
            font-family: 'Bebas Neue', sans-serif;
            font-size: 28px;
            color: #1a1a1a;
            letter-spacing: 1px;
        }}
        
        .report-meta-block {{ text-align: right; }}
        .report-meta {{
            font-size: 11px;
            color: #999;
            text-transform: uppercase;
            letter-spacing: 1px;
        }}
        
        .report-date {{
            font-size: 11px;
            color: #999;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-top: 2px;
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }}
        
        .section-title {{
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            color: #999;
            padding: 10px 0;
            margin-bottom: 8px;
        }}
        
        .numbers-section {{ margin-bottom: 20px; }}
        
        .numbers-grid {{
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 12px;
            margin-bottom: 12px;
        }}
        
        .stat-box {{
            background: #f5f5f5;
            border-radius: 8px;
            padding: 14px 12px;
            text-align: center;
        }}
        
        .stat-box.rollover-box {{ background: #fafafa; }}
        .stat-box.rollover-box .stat-value {{ color: #999; }}
        
        .stat-value {{
            font-family: 'Bebas Neue', sans-serif;
            font-size: 28px;
            color: #333;
        }}
        
        .stat-value.grey {{ color: #666; }}
        .stat-value.red {{ color: #ED1C24; }}
        
        .stat-label {{
            font-size: 9px;
            font-weight: 600;
            color: #999;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-top: 2px;
        }}
        
        .progress-bar {{
            height: 6px;
            background: #e5e5e5;
            border-radius: 3px;
            overflow: hidden;
        }}
        
        .progress-fill {{
            height: 100%;
            background: #ED1C24;
            border-radius: 3px;
        }}
        
        .projects-section {{ margin-bottom: 20px; }}
        
        .projects-table {{
            width: 100%;
            border-collapse: collapse;
            font-size: 11px;
        }}
        
        .projects-table th {{
            text-align: left;
            font-size: 9px;
            font-weight: 600;
            color: #999;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            padding: 8px 0;
            border-bottom: 2px solid #e5e5e5;
        }}
        
        .projects-table th:last-child {{ text-align: right; }}
        
        .projects-table td {{
            padding: 10px 0;
            border-bottom: 1px solid #f0f0f0;
            color: #666;
            vertical-align: top;
        }}
        
        .projects-table td.description {{
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 180px;
        }}
        
        .projects-table tr:last-child td {{ border-bottom: none; }}
        
        .project-name {{ font-weight: 600; color: #333; }}
        .amount {{ text-align: right; font-weight: 600; color: #333; }}
        .amount.ballpark {{ color: #ED1C24; }}
        .amount.onus {{ color: #999; }}
        
        .more-projects {{
            text-align: right;
            font-size: 10px;
            font-weight: 600;
            color: #999;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-top: 12px;
            padding-top: 12px;
            border-top: 1px solid #f0f0f0;
        }}
        
        .two-col {{
            display: grid;
            grid-template-columns: 1.2fr 1fr;
            gap: 20px;
            margin-bottom: 20px;
        }}
        
        .chart-section {{
            background: #fafafa;
            border-radius: 8px;
            padding: 16px;
        }}
        
        .chart-wrapper {{
            position: relative;
            padding-left: 32px;
            height: 120px;
        }}
        
        .y-axis {{
            position: absolute;
            left: 0;
            top: 0;
            bottom: 20px;
            width: 28px;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
        }}
        
        .y-label {{
            font-size: 8px;
            color: #999;
            text-align: right;
            padding-right: 4px;
        }}
        
        .chart-container {{
            display: flex;
            align-items: flex-end;
            gap: 8px;
            height: 100px;
            position: relative;
        }}
        
        .committed-line {{
            position: absolute;
            left: 0;
            right: 0;
            border-top: 1.5px dashed #c0c0c0;
            z-index: 5;
        }}
        
        .bar-group {{
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
        }}
        
        .bar-stack {{
            position: relative;
            width: 24px;
        }}
        
        .bar-committed {{
            width: 100%;
            background: #e0e0e0;
            border-radius: 2px 2px 0 0;
        }}
        
        .bar-spend {{
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            background: #ED1C24;
            border-radius: 2px 2px 0 0;
        }}
        
        .bar-label {{
            font-size: 8px;
            color: #999;
            text-transform: uppercase;
            margin-top: 6px;
        }}
        
        .chart-legend {{
            display: flex;
            justify-content: center;
            gap: 16px;
            margin-top: 12px;
            padding-top: 10px;
            border-top: 1px solid #e5e5e5;
        }}
        
        .legend-item {{
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 8px;
            color: #666;
        }}
        
        .legend-swatch {{
            width: 12px;
            height: 8px;
            border-radius: 1px;
        }}
        
        .legend-swatch.spend {{ background: #ED1C24; }}
        .legend-swatch.committed {{ background: #e0e0e0; }}
        
        .notes-section {{
            background: #fafafa;
            border-radius: 8px;
            padding: 16px;
        }}
        
        .notes-list {{ list-style: none; }}
        
        .notes-list li {{
            font-size: 11px;
            color: #666;
            padding: 6px 0 6px 14px;
            position: relative;
            line-height: 1.4;
        }}
        
        .notes-list li::before {{
            content: '•';
            position: absolute;
            left: 0;
            color: #ED1C24;
            font-weight: bold;
        }}
        
        .footer {{
            position: absolute;
            bottom: 15mm;
            left: 20mm;
            right: 20mm;
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding-top: 12px;
            border-top: 1px solid #e5e5e5;
        }}
        
        .footer-left {{ display: flex; align-items: center; }}
        .footer-logo {{ height: 32px; width: auto; }}
        .footer-tagline {{
            font-size: 10px;
            color: #999;
            letter-spacing: 0.5px;
        }}
        
        @media print {{
            body {{ background: white; }}
            .page {{ margin: 0; padding: 20mm; page-break-after: always; }}
        }}
    </style>
</head>
<body>
    <div class="page">
        <header class="header">
            <div class="header-left">
                <img src="{IMAGE_BASE}/tracker-header.png" alt="Tracker" class="header-logo">
            </div>
            <div class="header-right">
                <img src="{IMAGE_BASE}/logos/{client['code']}.png" alt="{client['name']}" class="client-logo">
            </div>
        </header>
        
        <div class="report-title-row">
            <div class="client-name">{client['name']}</div>
            <div class="report-meta-block">
                <div class="report-meta">{quarter_label} · {month} {today.year}</div>
                <div class="report-date">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="2">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                    {report_date}
                </div>
            </div>
        </div>
        
        <div class="numbers-section">
            <div class="numbers-grid">
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
                <div class="stat-box rollover-box">
                    <div class="stat-value grey">+{format_currency(rollover)}</div>
                    <div class="stat-label">{rollover_quarter} Rollover</div>
                </div>
            </div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: {spend_percent}%;"></div>
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
                    <li><strong>Rollover</strong> – Credit from {rollover_quarter} underspend available this month.</li>
                    <li><strong>Always on</strong> – Includes 10% for meetings and ad-hoc consults.</li>
                </ul>
            </div>
        </div>
        
        <footer class="footer">
            <div class="footer-left">
                <img src="{IMAGE_BASE}/dot-ai2-logo.png" alt="ai²" class="footer-logo">
            </div>
            <div class="footer-tagline">agency intuition × artificial intelligence</div>
        </footer>
    </div>
    
    {page2_html}
</body>
</html>'''
    
    return html


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
    
    tracker_data = get_tracker_data(client_code, month)
    html = build_html(client, tracker_data, month, is_quarter)
    
    return Response(html, mimetype='text/html')


if __name__ == '__main__':
    app.run(debug=True, port=5000)
