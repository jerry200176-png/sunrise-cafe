#!/usr/bin/env python3
"""No-network write-ahead record and conservative recovery decisions."""
import json
import os
from pathlib import Path
import re

PROJECT = 'prj_5swHVn2nqzrZ50VYx1zoEXZAvKiP'
SHA = re.compile(r'[a-f0-9]{40}\Z')
DEPLOYMENT = re.compile(r'dpl_[A-Za-z0-9]+\Z')
RUN = re.compile(r'[1-9][0-9]{0,19}\Z')
DIGEST = re.compile(r'[a-f0-9A-F]{64}\Z')


def validate(intent):
    if not isinstance(intent, dict) or set(intent) != {'version', 'intent', 'run_id', 'attempt', 'commit', 'baseline', 'project'}:
        raise ValueError('invalid write-ahead fields')
    if (type(intent['version']) is not int or intent['version'] != 1 or intent['intent'] != 'code-only-release'
            or not isinstance(intent['run_id'], str) or not RUN.fullmatch(intent['run_id'])
            or not isinstance(intent['attempt'], str) or not RUN.fullmatch(intent['attempt'])
            or not isinstance(intent['commit'], str) or not SHA.fullmatch(intent['commit'])
            or not isinstance(intent['baseline'], str) or not DEPLOYMENT.fullmatch(intent['baseline'])
            or intent['project'] != PROJECT):
        raise ValueError('invalid write-ahead identity')
    return intent


def open_safe_directory(path):
    path = Path(os.path.abspath(path))
    directory = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in path.parts[1:]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | getattr(os, 'O_NOFOLLOW', 0), dir_fd=directory)
            os.close(directory)
            directory = child
        return directory
    except BaseException:
        os.close(directory)
        raise


def write_intent_at(parent, name, intent):
    validate(intent)
    if not isinstance(name, str) or name in ('', '.', '..') or '/' in name:
        raise ValueError('invalid intent filename')
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0)
    descriptor = os.open(name, flags, 0o600, dir_fd=parent)
    with os.fdopen(descriptor, 'w', encoding='utf8') as output:
        json.dump(intent, output, sort_keys=True, separators=(',', ':'))
        output.write('\n'); output.flush(); os.fsync(output.fileno())
    os.fsync(parent)


def write_intent(path, intent):
    """Create an exclusive bounded intent file; caller must upload before writes."""
    validate(intent)
    path = Path(path)
    parent = open_safe_directory(path.parent)
    try:
        write_intent_at(parent, path.name, intent)
    finally: os.close(parent)


def receipt_valid(upload_succeeded, artifact_id, digest):
    """Validate action output shape only; not independent archive authentication."""
    return (upload_succeeded is True and isinstance(artifact_id, str) and RUN.fullmatch(artifact_id) is not None
            and isinstance(digest, str) and DIGEST.fullmatch(digest) is not None)


def decision(intent, run_id, current, candidate=None, candidate_bound=False, healthy=None, *, attempt):
    """No I/O: unknown and third-party writers are never overwritten.

    candidate_bound must be established by independently validated evidence of
    the create response for this run, not merely matching a commit or hostname.
    """
    validate(intent)
    if (run_id != intent['run_id'] or attempt != intent['attempt']
            or not isinstance(current, str) or not DEPLOYMENT.fullmatch(current)):
        return 'unknown'
    if current == intent['baseline']:
        return 'unknown-in-flight'
    if candidate_bound is not True or not isinstance(candidate, str) or not DEPLOYMENT.fullmatch(candidate):
        return 'unknown-owner'
    if current != candidate:
        return 'unknown-owner'
    if healthy is True:
        return 'observe'
    return 'rollback-candidate'


def monitor(provider, intent, run_id, candidate=None, candidate_bound=False, *, attempt):
    """Research-only recovery controller; provider is synthetic in all tests."""
    try:
        current = provider.alias()
        state = decision(intent, run_id, current, candidate, candidate_bound, None, attempt=attempt)
        if state != 'rollback-candidate':
            return state
        try:
            health = provider.health(current)
        except Exception:
            health = None
        state = decision(intent, run_id, current, candidate, candidate_bound, health, attempt=attempt)
        if state != 'rollback-candidate':
            return state
        # Not atomic: another writer can act after this check.
        if provider.alias() != candidate:
            return 'unknown-owner'
        provider.rollback(intent['baseline'])
        if (provider.alias() == intent['baseline'] and provider.health(intent['baseline']) is True
                and provider.alias() == intent['baseline']):
            return 'rolled-back'
    except Exception:
        pass
    return 'unknown'


if __name__ == '__main__':
    raise SystemExit('Write-ahead research is hard-stopped; no platform operation is enabled')
