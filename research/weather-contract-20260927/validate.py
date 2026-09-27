"""Offline validation of captured research evidence; not application code."""
import hashlib
import json
import math
from datetime import datetime, timezone, timedelta
from pathlib import Path

BASE = Path(__file__).resolve().parent
JST = timezone(timedelta(hours=9))


def validate_payload(data):
    assert not data.get('error'), data
    assert data['timezone'] == 'Asia/Tokyo'
    assert data['utc_offset_seconds'] == 32400
    hourly, units = data['hourly'], data['hourly_units']
    times = hourly['time']
    assert units['time'] == 'unixtime'
    assert len(times) == 24 and len(set(times)) == 24
    assert all(isinstance(t, int) for t in times)
    assert all(b-a == 3600 for a, b in zip(times, times[1:]))
    assert len({datetime.fromtimestamp(t, JST).date() for t in times}) >= 2
    metrics = {}
    for metric in ('uv_index', 'precipitation_probability'):
        if metric not in hourly:
            continue
        values = hourly[metric]
        assert len(values) == len(times)
        assert units[metric] == ('%' if metric == 'precipitation_probability' else '')
        # Samples must be complete to pass this transport probe. The app contract
        # separately permits null and requires a visible missing-data state.
        assert all(type(v) in (int, float) and math.isfinite(v) and v >= 0 for v in values)
        if metric == 'precipitation_probability':
            assert all(v <= 100 for v in values)
        metrics[metric] = {'min': min(values), 'max': max(values), 'nullCount': 0}
    assert 'uv_index' in metrics
    return {'rows': len(times), 'firstJst': datetime.fromtimestamp(times[0], JST).isoformat(),
            'lastJst': datetime.fromtimestamp(times[-1], JST).isoformat(), 'metrics': metrics}


def main():
    summaries, payloads = {}, {}
    for file in sorted((BASE/'responses').glob('*.json')):
        data = json.loads(file.read_text())
        headers = file.with_suffix('.headers').read_text()
        assert '200 OK' in headers
        summaries[file.stem] = validate_payload(data)
        payloads[file.stem] = data
        summaries[file.stem]['serverDate'] = next(line[6:] for line in headers.splitlines() if line.lower().startswith('date: '))
    assert len(summaries) == 12
    assert len([k for k in summaries if k.endswith('-gfs')]) == 6
    comparisons = {}
    for site in ('tokyo', 'sapporo', 'naha', 'chichijima', 'matsumoto'):
        left, right = payloads[site+'-gfs']['hourly'], payloads[site+'-best']['hourly']
        comparisons[site] = {}
        for metric in ('uv_index', 'precipitation_probability'):
            a, b = dict(zip(left['time'], left[metric])), dict(zip(right['time'], right[metric]))
            shared = sorted(a.keys() & b.keys())
            comparisons[site][metric] = {'overlap': len(shared), 'different': sum(a[t] != b[t] for t in shared)}
    browser = json.loads((BASE/'browser-results.json').read_text())
    for result in browser['results']:
        assert result['status'] == 200 and result['type'] == 'cors'
        validate_payload(result['body'])
    assert len(browser['results']) == 2
    contract = json.loads((BASE/'contract.json').read_text())
    assert contract['sourcePolicyId'] == 'open-meteo-gfs-global-uv-pop-v1'
    cases = json.loads((BASE/'comparison-cases.json').read_text())
    assert len(cases) == len({c['id'] for c in cases}) == 12
    # Case schemas only. No application comparison engine has been implemented.
    assert all(c['input'] and c['expected'] for c in cases)
    manifest = json.loads((BASE/'source-manifest.json').read_text())
    for source in manifest['files']:
        local = BASE/'source'/source['localName']
        assert hashlib.sha256(local.read_bytes()).hexdigest() == source['sha256']
    result = {'verifiedAt': datetime.now(timezone.utc).isoformat(), 'status': 'PASS',
              'httpSamples': summaries, 'timeAlignedComparison': comparisons,
              'browser': {'version': browser['browser'], 'origin': browser['origin'], 'corsRequestsPassed': 2},
              'sourceFilesHashChecked': len(manifest['files']),
              'comparisonCaseSpecifications': len(cases),
              'comparisonEngineExecuted': False,
              'notVerified': ['iPhone Safari', 'production origin', 'distinct model update cycles', 'forecast accuracy', 'deployed API source SHA']}
    (BASE/'validation-results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k not in ('httpSamples','timeAlignedComparison')}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
