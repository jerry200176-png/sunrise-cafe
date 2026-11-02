#!/usr/bin/env python3
"""Read-only exact-merge source and required-check verification."""
import json
import re
from types import SimpleNamespace

a = SimpleNamespace(REPO='/repos/jerry200176-png/sunrise-cafe', MAX_ARCHIVE=1024*1024,
                    w=SimpleNamespace(SHA=re.compile(r'[a-f0-9]{40}\Z')))

def strict_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result: raise ValueError('duplicate JSON field')
        result[key] = value
    return result

a.strict_object = strict_object
BASE = 'https://api.github.com' + a.REPO
MINIMUM = {'Lint & Build', 'Playwright smoke', 'Agent Session Provenance'}


class Unverified(Exception):
    pass


def fetch(github, path):
    status, _, body = github._request(BASE + path, True)
    if status != 200 or len(body) > a.MAX_ARCHIVE:
        raise Unverified('source API unavailable')
    try: return json.loads(body, object_pairs_hook=a.strict_object)
    except Exception: raise Unverified('source API response invalid') from None


def required_rules(rules):
    if not isinstance(rules, list) or len(rules) >= 100:
        raise Unverified('required rules unavailable')
    required = {}
    for rule in rules:
        if not isinstance(rule, dict) or rule.get('type') != 'required_status_checks': continue
        params = rule.get('parameters')
        if not isinstance(params, dict) or params.get('strict_required_status_checks_policy') is not True:
            raise Unverified('strict required checks unavailable')
        checks = params.get('required_status_checks')
        if not isinstance(checks, list): raise Unverified('required check list unavailable')
        for item in checks:
            if not isinstance(item, dict) or not isinstance(item.get('context'), str) or not item['context']:
                raise Unverified('invalid required check')
            app = item.get('integration_id')
            if app is not None and (type(app) is not int or app <= 0): raise Unverified('invalid required check app')
            if item['context'] in required and required[item['context']] != app:
                raise Unverified('ambiguous required check app')
            required[item['context']] = app
    if not MINIMUM.issubset(required): raise Unverified('baseline required checks are missing')
    return required


def verify_checks(sha, required, runs, status):
    if not isinstance(runs, dict) or not isinstance(runs.get('check_runs'), list):
        raise Unverified('check runs unavailable')
    checks = runs['check_runs']
    if type(runs.get('total_count')) is not int or runs['total_count'] > len(checks) or len(checks) >= 100:
        raise Unverified('check run results incomplete')
    if not isinstance(status, dict) or not isinstance(status.get('statuses'), list):
        raise Unverified('commit statuses unavailable')
    statuses = status['statuses']
    if type(status.get('total_count')) is not int or status['total_count'] > len(statuses) or len(statuses) >= 100:
        raise Unverified('commit status results incomplete')
    for name, app_id in required.items():
        matching = [x for x in checks if isinstance(x, dict) and x.get('name') == name and x.get('head_sha') == sha]
        legacy = [x for x in statuses if isinstance(x, dict) and x.get('context') == name]
        if not matching and not legacy: raise Unverified('required check is missing')
        if matching:
            if any(type(x.get('id')) is not int or not isinstance(x.get('started_at'), str) for x in matching):
                raise Unverified('required check order unavailable')
            latest = max(matching, key=lambda x: (x['started_at'], x['id']))
            if latest.get('status') != 'completed' or latest.get('conclusion') != 'success':
                raise Unverified('required check is not green')
            if app_id is not None and (not isinstance(latest.get('app'), dict) or latest['app'].get('id') != app_id):
                raise Unverified('required check app mismatch')
        if legacy:
            if any(not isinstance(x.get('created_at'), str) or type(x.get('id')) is not int for x in legacy):
                raise Unverified('commit status order unavailable')
            latest = max(legacy, key=lambda x: (x['created_at'], x['id']))
            if latest.get('state') != 'success' or app_id is not None:
                raise Unverified('required commit status is not green')


def verify(github, merge_sha, expected_tree):
    if not isinstance(merge_sha, str) or not a.w.SHA.fullmatch(merge_sha) or not isinstance(expected_tree, str) or not a.w.SHA.fullmatch(expected_tree):
        raise Unverified('invalid merge source')
    required = required_rules(fetch(github, '/rules/branches/main?per_page=100'))
    pulls = fetch(github, '/commits/' + merge_sha + '/pulls?per_page=100')
    if not isinstance(pulls, list) or len(pulls) >= 100: raise Unverified('merge PR association unavailable')
    matched = [p for p in pulls if isinstance(p, dict) and p.get('merge_commit_sha') == merge_sha
               and p.get('merged_at') and isinstance(p.get('base'), dict) and p['base'].get('ref') == 'main']
    if len(matched) != 1 or not isinstance(matched[0].get('head'), dict):
        raise Unverified('exact merged PR unavailable')
    head = matched[0]['head'].get('sha')
    if not isinstance(head, str) or not a.w.SHA.fullmatch(head): raise Unverified('exact PR head unavailable')
    for sha in (merge_sha, head):
        commit = fetch(github, '/git/commits/' + sha)
        if not isinstance(commit, dict) or commit.get('sha') != sha or not isinstance(commit.get('tree'), dict) or commit['tree'].get('sha') != expected_tree:
            raise Unverified('merged and reviewed trees differ')
    checks = fetch(github, '/commits/' + head + '/check-runs?per_page=100')
    statuses = fetch(github, '/commits/' + head + '/status?per_page=100')
    verify_checks(head, required, checks, statuses)
    return {'merge': merge_sha, 'head': head, 'tree': expected_tree, 'required': sorted(required)}


if __name__ == '__main__':
    raise SystemExit('Source verification is held with the release')
