import type { ScenarioSnapshot } from '../api/types';
import { GROWTH_BASELINE } from './config';
import { el } from './dom';
import {
  pct,
  num,
  change,
  last,
  voteShare,
  policyDescription,
  paymentRange,
} from './format';
import { objectiveLabels } from './state';
import { renderChart } from './charts';
import { policyDecisions } from './policy-decisions';

export class ResultsView {
  private snapshot!: ScenarioSnapshot;
  show(snapshot: ScenarioSnapshot) {
    this.snapshot = snapshot;
    this.render();
  }
  private render() {
    const current = this.snapshot;
    const active = this.snapshot.selected;
    const p = active.usPolicy;
    const end = last(active);
    const ballot = current.ballot;
    const verified = current.selection !== 'search-incomplete';
    el('result-label').textContent = verified
      ? 'The simulated one-ballot outcome'
      : 'Unverified international outcome';
    el('solve-status').textContent = ballot.eligibleCandidateCount.toLocaleString() + ' funded packages';
    const passed = ballot.winnerId !== null;
    const plurality = current.statusQuoUnavailable;
    el('ballot-verdict').textContent = !ballot.leadingPolicyId
      ? plurality
        ? 'No fully funded package is available.'
        : 'No funded package. Current policy remains.'
      : passed
        ? plurality
          ? 'The package with the most votes wins.'
          : ballot.statusQuoReason === 'status-quo-majority'
            ? 'A majority chooses current policy.'
            : 'A majority chooses one complete package.'
        : 'No package wins a majority. Current policy remains.';
    el('ballot-support').textContent = ballot.leadingPolicyId
      ? 'The leading package receives ' +
        voteShare(ballot.topSupportPercent) +
        ' of all votes. ' +
        (plurality
          ? 'It wins without a majority threshold. Current policy is excluded from the ballot and cannot remain as a fallback.'
          : passed
            ? 'It passes the required majority.'
            : 'It needs more than 50% to pass; there is no second vote.')
      : 'No available package can fund every promise in every year under these assumptions.';
    el('ballot-leading').hidden = passed || !current.leading;
    el('ballot-leading').textContent =
      current.leading && !passed
        ? 'Leading package: ' + policyDescription(current.leading.usPolicy, current.mode === 'strategic')
        : '';
    el('decision-votes-note').textContent =
      (verified ? '' : 'The two sides’ choices are not yet verified as mutually consistent. ') +
      'These terms belong to ' +
      (passed ? 'the winning package' : 'the current-policy fallback') +
      ' and remain in place for ten years. Each voter chooses one fully funded package that maximizes their own expected income utility. Everyone knows the voting rule before making their choice.';
    el('policy-decisions').setAttribute(
      'aria-label',
      current.mode === 'strategic' ? 'Seven terms of the enacted US policy' : 'Six terms of the enacted US policy',
    );
    el('policy-decisions').innerHTML = policyDecisions(p, end, {
      region: 'us', mode: current.mode, employerPayment: paymentRange(active),
    });
    el('policy-strip').innerHTML = [
      [paymentRange(active), 'Employer pay after tax / prior wages'],
      [pct(end.benefitsScalePaid), 'Funded benefits / current total budget'],
      [change(end.allIncomeIndex), 'Average adult take-home income in year ten'],
    ]
      .map(
        ([value, label]) =>
          '<div class="policy-item"><strong>' + value + '</strong><span>' + label + '</span></div>',
      )
      .join('');
    el('policy-meaning').textContent =
      'Benefits include modeled cash payments and consumption support. Health insurance is not counted as cash. Year-ten US AI adoption: ' +
      pct(end.adoption) +
      '; productive capacity: ' +
      pct(end.capacityFactor) +
      ' of the starting level.';
    el('growth-summary').textContent =
      'Year-ten US GDP growth: ' + pct(end.gdpGrowthRate) + '/year. AI adds up to ' +
      num(current.inputs.usAiGrowth * 100) + ' percentage points a year on top of the ' +
      pct(GROWTH_BASELINE.us) + ' background growth assumption. Policy, labor-market and trade effects can outweigh that boost and shrink the economy.';
    const verdict = el('funding-verdict');
    const shortfall = !active.usAdmissible;
    verdict.hidden = !shortfall || plurality;
    verdict.classList.toggle('shortfall', shortfall);
    verdict.textContent = shortfall && !plurality
      ? 'The automatic current-policy fallback cannot fund all commitments in this scenario. It could not receive votes, but remains because no eligible package won a majority. Income figures use actual payments rather than the unfunded promises.'
      : '';
    renderChart(active.us);
    this.renderInternational();
    this.renderVotingDetails();
  }

  private renderVotingDetails() {
    const current = this.snapshot;
    el('selection-explanation').textContent =
      'There is one vote over complete packages. Each citizen chooses the fully funded package giving their household the highest ten-year income utility, taking the voting rule and the foreign choice as known. ' +
      (current.statusQuoUnavailable
        ? 'The exact current-policy package is excluded. The remaining fully funded package with the most population-weighted votes wins at any vote share. There is no current-policy fallback.'
        : 'A package passes only with more than 50% of the population-weighted vote. Otherwise the exact current-tax, current-benefit policy with current AI pace remains.');
    el('agenda-order').textContent =
      (current.statusQuoUnavailable
        ? 'Exact personal utility ties use a fixed policy-ID ordering. If packages tie for the most votes, the same ordering selects the winner. '
        : 'Exact personal utility ties prefer current policy when eligible, then the first package in a fixed policy-ID ordering. ') +
      'This specifies how people cast their votes; perfect rationality alone does not select a unique strategic-voting equilibrium. ' +
      (current.mode === 'strategic'
        ? 'The search checks whether the foreign actor’s best choice and the US ballot outcome are mutually consistent. ' +
          current.search.reason +
          ' '
        : '') +
      'Policies are chosen once and held for ten years. There is no runoff or later renegotiation.';
  }
  private renderInternational() {
    const current = this.snapshot;
    const strategic = current.mode === 'strategic';
    el('international-result').hidden = !strategic;
    if (!strategic) return;
    const active = this.snapshot.selected;
    const end = active.foreign!.at(-1)!;
    el('foreign-policy-objective').textContent = 'One actor chooses a fully funded package to maximize ' +
      objectiveLabels[current.foreignObjective].toLowerCase() + ' over ten years, given the US choice.';
    el('foreign-policy-decisions').innerHTML = policyDecisions(active.foreignPolicy!, end, {
      region: 'foreign', mode: current.mode,
    });
    el('foreign-policy-strip').innerHTML = [
      [change(end.workerIncomeIndex), 'Year-ten income · mainly work income'],
      [change(end.allIncomeIndex), 'Year-ten income · all adults'],
      [change(end.output), 'Year-ten economic output'],
    ].map(([value, label]) => '<div class="policy-item"><strong>' + value +
      '</strong><span>' + label + '</span></div>').join('');
    el('foreign-reference-note').textContent = 'Changes are relative to the foreign economy’s own starting values. Year-ten GDP growth: ' + pct(end.gdpGrowthRate) + '/year, with AI adding up to ' + num(current.inputs.foreignAiGrowth * 100) + ' percentage points to the ' + pct(GROWTH_BASELINE.foreign) + ' background growth assumption. Benefit shares and tax benchmarks use the US-based model reference, not measured foreign welfare systems or tax rates.';
    el('equilibrium-explanation').textContent =
      'Foreign objective: ' +
      objectiveLabels[current.foreignObjective].toLowerCase() +
      '. US voters and the foreign actor choose independently, each knowing the other’s chosen policy and the US voting rule. ' +
      (current.statusQuoUnavailable
        ? 'The foreign actor anticipates the most-voted available US package, even below 50%. Only the US current-policy package is excluded; the foreign actor can still choose its own current policy if fully funded. '
        : 'The foreign actor anticipates current US policy if no package wins a majority. ') +
      'AI pace, job retention, benefits, benefit rules, both tax rates and trade permission can all differ between them. ' +
      (current.pauseUnavailable
        ? 'Neither side can pause AI. Both choose current pace or acceleration for the ten-year scenario. '
        : 'Each policy stays in place for ten years. If both independently choose to pause, both pauses last the decade. ') +
      'Trade stays open only when both independently allow it. A domestic AI pause can still leave workers exposed to foreign competition. The foreign actor uses the US household distribution and behavioral rules as a modeling assumption, with separate economic size, trade exposure and frontier capability.';
    const verified = current.selection === 'verified-consistent';
    el('deviation').classList.toggle('unstable', !verified);
    this.renderTrade();
    el('deviation').textContent = verified
      ? 'The choices are mutually consistent: this foreign package maximizes its objective among fully funded options given the enacted US package, and the US ballot gives the displayed result given this foreign package.'
      : 'These choices are unverified. ' +
        current.search.reason +
        ' A consistent pair may exist outside the search; this result is not a verified equilibrium.';
  }
  private renderTrade() {
    const active = this.snapshot.selected;
    const us = last(active);
    el('trade-verdict').textContent = us.tradeOpen
      ? 'Trade stays open: both sides allow it.'
      : 'Trade is closed: ' +
        (!active.usPolicy.allowFreeTrade && !active.foreignPolicy!.allowFreeTrade
          ? 'both sides ban it.'
          : !active.usPolicy.allowFreeTrade ? 'the US bans it.' : 'the foreign actor bans it.');
    el('trade-impact').textContent =
      'Year ten: US consumer prices are ' + pct(us.consumerPriceIndex) +
      ' of their starting level, relative to US producer prices. Income figures include the modeled effects of trade on purchasing power and competition for jobs.';

  }

}
