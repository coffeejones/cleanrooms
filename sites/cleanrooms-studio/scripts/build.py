from pathlib import Path
from html import escape, unescape
from html.parser import HTMLParser
import re

root = Path(__file__).resolve().parent.parent
target = root / 'site/index.html'
original = target.read_text()
frame_match = re.search(r'(\bdata-srcdoc=")([^"]*)(")', original)
if not frame_match:
    raise ValueError('The existing sandboxed export is missing.')
inner = unescape(frame_match.group(2))
app_match = re.search(r'<div id="cleanrooms-studio"[\s\S]*?</script>\s*</div>', inner)
if not app_match:
    raise ValueError('The application root is missing.')

css = '\n'.join((root / 'src' / name).read_text() for name in ['app.css', 'upgrade.css', 'calendar.css', 'actions.css', 'planning.css', 'staffing.css', 'demo.css', 'operations.css', 'controls.css', 'motion.css', 'spacing.css', 'panel-spacing.css', 'surfaces.css', 'descriptions.css', 'rich-editor.css', 'employee.css', 'employee-shell.css', 'departments.css', 'accounts.css', 'admin-pages.css', 'planning-workspace.css', 'series-page.css', 'roster.css', 'employee-profile.css', 'payroll.css', 'payroll-groups.css', 'payroll-person-group.css', 'product-workspace.css', 'product-details.css', 'premium.css', 'layout-rhythm.css', 'overlay-rhythm.css', 'overlay-admin-spacing.css', 'control-scale.css', 'control-fields.css', 'series-editor.css', 'payroll-open.css', 'people-open.css', 'employee-profile-open.css', 'admin-open.css', 'leave-open.css', 'planning-open.css', 'series-open.css', 'accounts-open.css', 'accounts-editor-open.css', 'history-open.css', 'workspace-open.css', 'timekeeping.css', 'timekeeping-employee.css', 'timekeeping-integration.css', 'planned-breaks.css', 'scroll-spacing.css', 'review.css', 'personal-pay-layout.css', 'page-help.css', 'shift-workflow.css', 'publication-range.css', 'workflow-integration.css', 'publication-review.css', 'workflow-requests.css', 'workflow-read-status.css', 'workflow-detail-structure.css', 'compact-workspace.css', 'compact-admin.css', 'workspace-chrome.css', 'workspace-people-payroll.css', 'workspace-admin-chrome.css', 'overlay-workspace-chrome.css', 'series-register.css', 'chat.css', 'workspace-compass.css', 'accounts-compass.css', 'payroll-compass.css', 'people-compass.css', 'review-compass.css', 'hours-compass.css', 'planner-compass.css', 'employee-compass.css', 'chat-workflow-compass.css', 'settings-compass.css', 'planning-availability.css', 'workspace-budgets.css', 'planning-budget-impact.css', 'planning-cost-view.css', 'sickness-flow.css', 'address-lookup.css', 'sidebar-compass.css', 'payroll-period-view.css', 'payroll-export-profile-view.css'])
script = '\n'.join((root / 'src' / name).read_text() for name in ['instruction-state.js', 'description-model.js', 'checklist-progress.js', 'planning-records.js', 'planning-scope.js', 'planning-window.js', 'planning-viewport.js', 'studio-persistence.js', 'department-model.js', 'departments-view.js', 'employee-calendar.js', 'employee-persistence.js', 'timekeeping-model.js', 'timekeeping-employee.js', 'employee-view.js', 'series-engine.js', 'series-planner.js', 'series-lifecycle.js', 'series-calendar.js', 'series-overview.js', 'roster-model.js', 'roster-planning.js', 'employee-profile-calendar.js', 'payroll-model.js', 'payroll-groups-model.js', 'payroll-group-members.js', 'payroll-period-model.js', 'studio-data.js', 'directory-records.js', 'directory-persistence.js', 'planning-reconcile.js', 'roster-view.js', 'employee-profile-view.js', 'payroll-view.js', 'payroll-groups-view.js', 'payroll-person-group-view.js', 'workspace-budgets.js', 'workspace-guide.js', 'accounts-view.js', 'schedule-actions.js', 'bulk-actions.js', 'plan-changes.js', 'publication-model.js', 'staffing-engine.js', 'coverage-engine.js', 'demo-fixtures.js', 'series-examples.js', 'calendar-viewport.js', 'calendar-view.js', 'rich-description.bundle.js', 'payroll-export-profile-model.js', 'payroll-export-profile-view.js', 'payroll-period-view.js', 'timekeeping-view.js', 'review-view.js', 'page-help.js', 'workflow-requests-view.js', 'workflow-read-status.js', 'shift-workflow-view.js', 'publication-range.js', 'publication-budget.js', 'planning-budget-impact.js', 'planning-cost-view.js', 'sickness-flow.js', 'publication-review-view.js', 'chat-view.js', 'planning-availability.js', 'app.js'])
markup = (root / 'src/app.html').read_text()
if '</script' in script.lower() or '</style' in css.lower():
    raise ValueError('Unexpected closing tag in application source.')
app = markup.replace('<!-- APP_STYLE -->', '<style>\n' + css + '\n</style>')
app = app.replace('<!-- APP_SCRIPT -->', '<script>\n' + script + '\n</script>')
new_inner = inner[:app_match.start()] + app + inner[app_match.end():]
vendor = (root / 'src/vendor-runtime.bundle.js').read_text()
if '</script' in vendor.lower():
    raise ValueError('Unexpected closing tag in bundled runtime.')
# Replace the original executable CDN dependencies while preserving the export's
# iframe and CSP verbatim. Rebuilding is idempotent after the first replacement.
vendor_tag = '<script id="cleanrooms-vendor-runtime">' + vendor + '</script>'
vendor_match = r'<script id="cleanrooms-vendor-runtime">[\s\S]*?</script>|<script src="https://unpkg.com/@floating-ui/core@[^\"]+">\s*</script>'
new_inner, vendor_count = re.subn(vendor_match, lambda _: vendor_tag, new_inner)
if vendor_count != 1:
    raise ValueError('The single pinned runtime insertion point is missing.')
new_inner = re.sub(r'<script[^>]*src="https://unpkg.com/(?:@floating-ui/dom|lucide)@[^\"]+"[^>]*>\s*</script>', '', new_inner)
new_inner = re.sub(r'<style id="cleanrooms-fullscreen">[\s\S]*?</style>\s*', '', new_inner)
new_inner = re.sub(r'<title>[\s\S]*?</title>', '<title>CleanRooms · Vagtplan</title>', new_inner, count=1)
updated = original[:frame_match.start(2)] + escape(new_inner, quote=True) + original[frame_match.end(2):]
updated = re.sub(r'<title>[\s\S]*?</title>', '<title>CleanRooms · Vagtplan</title>', updated, count=1)

parent_bridge = (root / 'src/storage-parent.js').read_text()
if '</script' in parent_bridge.lower():
    raise ValueError('Unexpected closing tag in storage bridge.')
updated = re.sub(r'<script id="cleanrooms-storage-parent">[\s\S]*?</script>\s*', '', updated)
position = updated.index('<script>')
updated = updated[:position] + '<script id="cleanrooms-storage-parent">' + parent_bridge + '</script>\n' + updated[position:]

class Policy(HTMLParser):
    def __init__(self):
        super().__init__()
        self.csp = []
        self.sandbox = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'meta' and attrs.get('http-equiv', '').lower() == 'content-security-policy':
            self.csp.append(attrs.get('content'))
        if tag == 'iframe':
            self.sandbox.append(attrs.get('sandbox'))

def policy(html):
    parser = Policy()
    parser.feed(html)
    return parser.csp, parser.sandbox

if policy(original) != policy(updated) or policy(inner) != policy(new_inner):
    raise ValueError('The export sandbox or CSP changed.')
target.write_text(updated)
print('Built CleanRooms UI; original iframe sandbox and both CSP policies preserved.')
