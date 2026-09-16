#!/usr/bin/env python3
"""Build the simulator's weighted adult-citizen cohorts from official CPS ASEC.

Python 3.13+, standard library only. Raw survey files stay in --cache-dir.
See docs/us-electorate-data.md for definitions, choices, and limitations.
"""
import argparse
import collections
import hashlib
import json
import math
import pathlib
import re
import urllib.request
import zipfile

BASE_URL = 'https://www2.census.gov/programs-surveys/cps/datasets/2026/march/'
SOURCE_FILES = ['asec2026_pubuse.zip', 'persfmt.txt']
FIELDS = '''PH_SEQ MARSUPWT A_AGE PRCITSHP PEMLR PRPERTYP PEARNVAL WSAL_VAL SEMP_VAL
FRSE_VAL PTOTVAL INT_VAL TRDINT_VAL DIV_VAL RNT_VAL CAP_VAL PNSN_VAL ANN_VAL
DBTN_VAL RINT_VAL1 RINT_VAL2 SS_VAL SSI_VAL UC_VAL PAW_VAL VET_VAL FEDTAX_AC
STATETAX_A FICA SPM_ID SPM_SNAPSUB SPM_WICVAL SPM_SCHLUNCH SPM_CAPHOUSESUB
SPM_ENGVAL MCARE MCAID DIS_SC1 DIS_SC2 DIS_VAL1 DIS_VAL2 SUR_SC1 SUR_SC2
SUR_VAL1 SUR_VAL2'''.split()
CASH_FIELDS = ['SS_VAL', 'SSI_VAL', 'UC_VAL', 'PAW_VAL', 'VET_VAL']
NONCASH_FIELDS = ['SPM_SNAPSUB', 'SPM_WICVAL', 'SPM_SCHLUNCH',
                  'SPM_CAPHOUSESUB', 'SPM_ENGVAL']
AMOUNTS = ['laborIncome', 'capitalIncome', 'pensionIncome', 'otherIncome',
           'benefits', 'cashBenefits', 'noncashBenefits', 'tax', 'payrollTax',
           'incomeTax', 'laborTaxBaseline', 'capitalTaxBaseline',
           'noncapitalTaxBase', 'capitalTaxBase', 'priorIncome', 'ownLaborIncome',
           'capitalGains', 'grossIncome', 'disposableIncome']
GROUPS = ['work', 'benefits', 'pension', 'capital', 'other']
EMPLOYMENTS = ['employed', 'unemployed', 'retired', 'inactive']


def rounded(value):
    return round(value, 8)


def primary_source(components):
    """Largest positive amount, deterministic order for exact ties."""
    if max(components.values(), default=0) <= 0:
        return 'none'
    return max(components, key=components.get)


def get_person_components(p):
    # PEARNVAL is the edited total. It differs from the sum of the three edited
    # component fields on one record in this release; use the official total.
    labor = p['PEARNVAL']
    cash = sum(p[k] for k in CASH_FIELDS)
    # Social Security already contains SSDI. Add separately identifiable public
    # black-lung/state-sickness benefits, but keep public employee pensions with
    # retirement/other income rather than label them means-tested welfare.
    cash += sum(p[f'DIS_VAL{i}'] for i in (1, 2) if p[f'DIS_SC{i}'] in (8, 9))
    cash += sum(p[f'SUR_VAL{i}'] for i in (1, 2) if p[f'SUR_SC{i}'] == 7)
    interest = p['TRDINT_VAL']
    capital = interest + p['DIV_VAL'] + p['RNT_VAL']
    pension = (p['PNSN_VAL'] + max(0, p['ANN_VAL']) + p['DBTN_VAL']
               + p['RINT_VAL1'] + p['RINT_VAL2'])
    other = p['PTOTVAL'] - labor - capital - pension - cash
    # CAP_VAL is edited capital gains (reported or imputed); PTOTVAL excludes it.
    # Include it once to represent asset-sale income and match the tax base.
    capital += p['CAP_VAL']
    return {'laborIncome': labor, 'capitalIncome': capital,
            'pensionIncome': pension, 'otherIncome': other,
            'cashBenefits': cash, 'capitalGains': p['CAP_VAL']}


def build(cache):
    layout = {}
    for line in (cache / 'persfmt.txt').read_text().splitlines():
        m = re.match(r'(\w+)\s+(\d+)\s+(\d+)', line)
        if m:
            layout[m[1]] = (int(m[3]) - 1, int(m[2]))
    assert set(FIELDS) <= set(layout), set(FIELDS) - set(layout)
    households = collections.defaultdict(list)
    count = 0
    with zipfile.ZipFile(cache / 'asec2026_pubuse.zip') as archive:
        with archive.open('asec2026_pubuse.dat') as records:
            for record in records:
                if record[:1] != b'3':
                    continue
                p = {k: int(record[layout[k][0]:layout[k][0] + layout[k][1]])
                     for k in FIELDS}
                p.update(get_person_components(p))
                households[p['PH_SEQ']].append(p)
                count += 1

    rows = []
    for people in households.values():
        adults = sum(p['A_AGE'] >= 18 for p in people)
        if not adults:
            continue
        units = {}
        for p in people:
            # Every member repeats the SPM unit amounts. Count each unit once;
            # summing all people or all members receiving SNAP would duplicate it.
            if p['SPM_ID']:
                unit = tuple(p[k] for k in NONCASH_FIELDS)
                if p['SPM_ID'] in units:
                    assert units[p['SPM_ID']] == unit
                units[p['SPM_ID']] = unit
        sums = {k: sum(p[k] for p in people) for k in
                ['laborIncome', 'capitalIncome', 'pensionIncome', 'otherIncome',
                 'cashBenefits', 'capitalGains']}
        sums['noncashBenefits'] = sum(sum(v) for v in units.values())
        sums['benefits'] = sums['cashBenefits'] + sums['noncashBenefits']
        sums['incomeTax'] = sum(p['FEDTAX_AC'] + p['STATETAX_A'] for p in people)
        sums['payrollTax'] = sum(p['FICA'] for p in people)
        sums['tax'] = sums['incomeTax'] + sums['payrollTax']
        sums['noncapitalTaxBase'] = max(0, sums['laborIncome']) + max(0, sums['pensionIncome']) + max(0, sums['otherIncome'])
        sums['capitalTaxBase'] = max(0, sums['capitalIncome'])
        market_base = sums['noncapitalTaxBase'] + sums['capitalTaxBase']
        capital_fraction = sums['capitalTaxBase'] / market_base if market_base else 0
        sums['capitalTaxBaseline'] = sums['incomeTax'] * capital_fraction
        sums['laborTaxBaseline'] = sums['tax'] - sums['capitalTaxBaseline']
        sums['priorIncome'] = sums['laborIncome']
        sums['grossIncome'] = sums['laborIncome'] + sums['capitalIncome'] + sums['pensionIncome'] + sums['otherIncome'] + sums['benefits']
        sums['disposableIncome'] = sums['grossIncome'] - sums['tax']
        source_amounts = {'work': sums['laborIncome'], 'benefits': sums['benefits'],
                         'pension': sums['pensionIncome'], 'capital': sums['capitalIncome'],
                         'other': sums['otherIncome']}
        hh_source = primary_source(source_amounts)
        per_adult = {k: v / adults for k, v in sums.items()}
        for p in people:
            if p['A_AGE'] < 18 or p['PRCITSHP'] not in (1, 2, 3, 4) or p['MARSUPWT'] <= 0:
                continue
            employment = ('employed' if p['PEMLR'] in (1, 2) or p['PRPERTYP'] == 3 else 'unemployed'
                          if p['PEMLR'] in (3, 4) else 'retired'
                          if p['PEMLR'] == 5 else 'inactive')
            personal_source = primary_source({
                'work': p['laborIncome'], 'benefits': p['cashBenefits'],
                'pension': p['pensionIncome'], 'capital': p['capitalIncome'],
                'other': p['otherIncome']})
            own_cash = p['cashBenefits'] > 0
            noncash = sums['noncashBenefits'] > 0
            medicare = p['MCARE'] == 1
            medicaid = p['MCAID'] == 1
            flags = {
                'publicCash': own_cash,
                'socialSecurity': p['SS_VAL'] > 0,
                'ssi': p['SSI_VAL'] > 0,
                'unemploymentCompensation': p['UC_VAL'] > 0,
                'cashAssistance': p['PAW_VAL'] > 0,
                'veteransBenefits': p['VET_VAL'] > 0,
                'medicare': medicare,
                'medicaid': medicaid,
                'householdNoncashBenefits': noncash,
                'householdSnap': any(v[0] > 0 for v in units.values()),
                'anyMeasuredPublicBenefit': own_cash or noncash or medicare or medicaid,
                'householdPublicCash': sums['cashBenefits'] > 0,
                'laborIncome': p['laborIncome'] > 0,
                'capitalIncome': p['capitalIncome'] > 0,
                'pensionIncome': p['pensionIncome'] > 0,
                'disabledNotInLaborForce': p['PEMLR'] == 6,
                'activeMilitaryInSample': p['PRPERTYP'] == 3,
            }
            rows.append({**per_adult, 'ownLaborIncome': p['laborIncome'],
                         'weight': p['MARSUPWT'] / 100, 'employment': employment,
                         'group': 'other' if hh_source == 'none' else hh_source,
                         'personalGroup': personal_source, 'flags': flags})
    population = math.fsum(row['weight'] for row in rows)
    # Weighted quintiles of resources before simulated taxes: adult citizens are
    # the units, not households. Equal-income households remain in the same band.
    cumulative = 0
    boundaries = []
    ordered = sorted(rows, key=lambda row: row['grossIncome'])
    for row in ordered:
        while len(boundaries) < 4 and cumulative >= population * (len(boundaries) + 1) / 5:
            boundaries.append(row['grossIncome'])
        cumulative += row['weight']
    for row in rows:
        row['incomeQuintile'] = 1 + sum(row['grossIncome'] >= value for value in boundaries)
    bins = collections.defaultdict(list)
    for row in rows:
        bins[(row['group'], row['incomeQuintile'], row['employment'])].append(row)
    cohorts = []
    for (group, quintile, employment), members in sorted(bins.items()):
        weight = math.fsum(row['weight'] for row in members)
        amounts = {key: rounded(math.fsum(row[key] * row['weight'] for row in members) / weight)
                   for key in AMOUNTS}
        cohorts.append({'id': f'{group}-q{quintile}-{employment}',
                        'weight': round(weight / population, 14),
                        'group': group, 'incomeQuintile': quintile,
                        'incomeBand': ['Lowest fifth', 'Second fifth', 'Middle fifth', 'Fourth fifth', 'Highest fifth'][quintile - 1],
                        'employment': employment, **amounts})
    means = {key: rounded(math.fsum(row[key] * row['weight'] for row in rows) / population)
             for key in AMOUNTS}
    def distribution(key, values):
        return {value: round(math.fsum(row['weight'] for row in rows if row[key] == value) / population, 12)
                for value in values}
    def flag_share(flag):
        return round(math.fsum(row['weight'] for row in rows if row['flags'][flag]) / population, 12)
    metadata = {
        'surveyYear': 2026, 'incomeYear': 2025, 'retrievedOn': '2026-09-16',
        'survey': 'Current Population Survey, 2026 Annual Social and Economic Supplement',
        'populationDefinition': 'US citizens age 18+ represented by the CPS ASEC sample, including its covered military households; each adult citizen has equal voting weight; no turnout adjustment.',
        'population': rounded(population), 'samplePeople': count,
        'sampleAdultCitizens': len(rows), 'cohortCount': len(cohorts),
        'personalPrimaryIncomeShares': distribution('personalGroup', GROUPS + ['none']),
        'householdPrimaryIncomeShares': distribution('group', GROUPS),
        'employmentShares': distribution('employment', EMPLOYMENTS),
        'incomeQuintileShares': distribution('incomeQuintile', [1, 2, 3, 4, 5]),
        'incomeQuintileBoundaries': list(map(rounded, boundaries)),
        'incomeQuintiles': [{
            'quintile': q,
            'weight': rounded(math.fsum(row['weight'] for row in rows if row['incomeQuintile'] == q) / population),
            **{key: rounded(math.fsum(row[key] * row['weight'] for row in rows if row['incomeQuintile'] == q) / math.fsum(row['weight'] for row in rows if row['incomeQuintile'] == q))
               for key in ('grossIncome', 'disposableIncome', 'laborIncome', 'capitalIncome', 'benefits', 'tax')}
        } for q in range(1, 6)],
        'receiptShares': {flag: flag_share(flag) for flag in rows[0]['flags']},
        'perAdultMeans': means,
        'baselineLaborTaxRate': means['laborTaxBaseline'] / means['noncapitalTaxBase'],
        'baselineCapitalTaxRate': means['capitalTaxBaseline'] / means['capitalTaxBase'],
        'baselineTotalTaxRate': means['tax'] / (means['noncapitalTaxBase'] + means['capitalTaxBase']),
        'sources': {
            'dataset': 'https://www.census.gov/data/datasets/2026/demo/cps/cps-asec-2026.html',
            'archive': BASE_URL + SOURCE_FILES[0],
            'layout': BASE_URL + SOURCE_FILES[1],
            'dictionary': BASE_URL + 'asec2026_ddl_pub_full.pdf',
            'taxModel': 'https://www.census.gov/topics/income-poverty/income/guidance/tax-model.html',
            'populationCoverage': 'https://www.census.gov/topics/income-poverty/guidance/group-quarters.html',
            'capitalGains': 'https://www.census.gov/content/dam/Census/library/working-papers/2022/demo/sehsd-wp2022-18.pdf',
        },
        'sourceSha256': {file: hashlib.sha256((cache / file).read_bytes()).hexdigest() for file in SOURCE_FILES},
    }
    assert abs(math.fsum(row['weight'] for row in cohorts) - 1) < 1e-10
    for row in cohorts:
        assert abs(row['laborTaxBaseline'] + row['capitalTaxBaseline'] - row['tax']) < 1e-6
        assert abs(row['benefits'] - row['cashBenefits'] - row['noncashBenefits']) < 1e-6
    # Compression must preserve all weighted income/tax/benefit moments.
    for key, mean in means.items():
        assert abs(math.fsum(row['weight'] * row[key] for row in cohorts) - mean) < 1e-5, key
    return {'metadata': metadata, 'cohorts': cohorts}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache-dir', type=pathlib.Path, default=pathlib.Path('/tmp/ai-pirates-cps-2026'))
    parser.add_argument('--output', type=pathlib.Path, default=pathlib.Path('calculator/data/us-electorate-data.json'))
    parser.add_argument('--offline', action='store_true', help='Use previously downloaded official files only.')
    args = parser.parse_args()
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    for name in SOURCE_FILES:
        target = args.cache_dir / name
        if not target.exists():
            if args.offline:
                raise FileNotFoundError(target)
            urllib.request.urlretrieve(BASE_URL + name, target)
    data = build(args.cache_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps(data['metadata'], indent=2))


if __name__ == '__main__':
    main()
