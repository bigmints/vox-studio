#!/usr/bin/env python3
"""Merge Fikr Vox into the existing Firebase Hosting release; preserve other paths.
Uses the configured deployment identity, never stores access tokens.
Defaults to a read-only plan. Pass --publish to deploy the verified source.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.error
import urllib.parse
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--site', required=True, help='Verified Firebase Hosting site ID for fikr.one')
parser.add_argument('--publish', action='store_true')
args = parser.parse_args()
api = 'https://firebasehosting.googleapis.com/v1beta1/'
result = subprocess.run(['gcloud', '--configuration=fikr-deploy', 'auth', 'print-access-token'], capture_output=True, text=True, check=True)
token = result.stdout.strip()

def call(method, path, data=None):
    body = json.dumps(data).encode() if data is not None else None
    request = urllib.request.Request(api + path, data=body, method=method,
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise SystemExit(f'Hosting API {error.code}: {error.read().decode()}') from None

def pages(path, key):
    items = []
    while True:
        response = call('GET', path)
        items.extend(response.get(key, []))
        if not response.get('nextPageToken'):
            return items
        path = path.split('?')[0] + '?pageSize=1000&pageToken=' + urllib.parse.quote(response['nextPageToken'])

site = 'sites/' + args.site
# Verify this is the intended domain before preparing a mutation.
domains = pages(site + '/customDomains?pageSize=1000', 'customDomains')
if not any(d['name'].split('/')[-1] in ('fikr.one', 'www.fikr.one') for d in domains):
    raise SystemExit('Selected site does not contain the verified fikr.one custom domain.')
release = call('GET', site + '/releases?pageSize=1')['releases'][0]
previous = release['version']['name']
version = call('GET', previous)
files = {f['path']: f['hash'] for f in pages(previous + '/files?pageSize=1000', 'files')}
# Own only the /vox subtree. Every unrelated live file hash is retained.
files = {path: digest for path, digest in files.items() if not path.startswith('/vox/')}
uploads = {}
root = Path(__file__).resolve().parents[1] / 'dist'
for path in sorted(root.rglob('*')):
    if not path.is_file() or path.name.startswith('.'):
        continue
    content = gzip.compress(path.read_bytes(), mtime=0)
    digest = hashlib.sha256(content).hexdigest()
    files['/vox/' + path.relative_to(root).as_posix()] = digest
    uploads[digest] = content
config = version.get('config', {}).copy()
# Directories resolve to their static index before the main app catch-all.
rewrites = [r for r in config.get('rewrites', []) if r.get('glob') not in ('/vox', '/vox/', '/vox/docs', '/vox/docs/')]
config['rewrites'] = [
    {'glob': '/vox', 'path': '/vox/index.html'},
    {'glob': '/vox/', 'path': '/vox/index.html'},
    {'glob': '/vox/docs', 'path': '/vox/docs/index.html'},
    {'glob': '/vox/docs/', 'path': '/vox/docs/index.html'},
] + rewrites
# Relative links require the directory URL on both entry points.
redirects = [r for r in config.get('redirects', []) if r.get('glob') not in ('/vox', '/vox/docs')]
config['redirects'] = [
    {'glob': '/vox', 'location': '/vox/', 'statusCode': 301},
    {'glob': '/vox/docs', 'location': '/vox/docs/', 'statusCode': 301},
] + redirects
print(json.dumps({'site': site, 'previousVersion': previous, 'fileCount': len(files), 'voxFiles': len(uploads), 'publish': args.publish}, indent=2))
if not args.publish:
    raise SystemExit(0)
created = call('POST', site + '/versions', {'config': config})
name = created['name']
plan = call('POST', name + ':populateFiles', {'files': files})
for digest in plan.get('uploadRequiredHashes', []):
    if digest not in uploads:
        raise SystemExit('An unrelated live file needs upload; stopping to preserve live content.')
    request = urllib.request.Request(plan['uploadUrl'] + '/' + digest, data=uploads[digest], method='POST',
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/octet-stream'})
    with urllib.request.urlopen(request) as response:
        response.read()
call('PATCH', name + '?updateMask=status', {'status': 'FINALIZED'})
# Stop if another deployment happened while this one was prepared.
if call('GET', site + '/releases?pageSize=1')['releases'][0]['version']['name'] != previous:
    raise SystemExit('Live Hosting changed during preparation; rerun against the latest release.')
result = call('POST', site + '/releases?versionName=' + urllib.parse.quote(name, safe=''), {})
print(json.dumps({'release': result['name'], 'version': name, 'url': 'https://fikr.one/vox/'}, indent=2))
