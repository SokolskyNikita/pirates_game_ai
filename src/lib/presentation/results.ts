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
    const coordinated = ballot.coordination.stable;
    el('result-label').textContent = 'The simulated one-ballot outcome';
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
        ' of all adult citizens, including abstainers. ' +
        (plurality
          ? 'It wins without a majority threshold. Current policy is excluded from the ballot and cannot remain as a fallback.'
          : passed
            ? 'It passes the required majority.'
            : 'It needs more than 50% to pass; there is no second vote.')
      : 'No available package can fund every promise in every year under these assumptions.';
    el('coordination-summary').textContent = coordinated
      ? (ballot.coordination.steps
          ? voteShare(ballot.coordination.strategicVoterPercent) + ' of voters choose a different package from their first choice. ' +
            (ballot.coordination.changedOutcome ? 'Compromise changes the outcome. ' : 'Compromise leaves the enacted outcome unchanged. ')
          : 'No winning compromise improves on the initial outcome for its supporters. ') +
        'No further profitable coalition switch or withdrawal to restore current policy was found under this protocol. This is not a proof of a unique equilibrium. There is one final ballot.'
      : 'The coordination rule selects the recorded funded outcome with the smallest strongest-challenger support, with fixed tie-breaking. This resolves competing coalitions; it does not imply that no voter could prefer a different agreement.';
    el('ballot-leading').hidden = passed || !current.leading;
    el('ballot-leading').textContent =
      current.leading && !passed
        ? 'Leading package: ' + policyDescription(current.leading.usPolicy, current.mode === 'strategic')
        : '';
    el('decision-votes-note').textContent =
      (current.selection === 'selected-by-rule' ? 'The fixed resolution rule selects this outcome. ' : '') +
      'Support is for the whole package, not a separate majority endorsement of each term. These terms belong to ' +
      (passed ? 'the selected winning package' : 'the current-policy fallback') +
      ' and remain in place for ten years. Voters may support a funded compromise to achieve a better outcome for themselves than insisting on their first choice. Everyone knows the voting rule before making their choice.';
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
      'There is one vote over complete packages. Initial intentions favor each citizen’s highest-utility funded package. Before the single ballot, voters who strictly prefer an enactable challenger to the anticipated outcome can consolidate their votes behind it; everyone else keeps their intended vote. ' +
      (current.statusQuoUnavailable
        ? 'The exact current-policy package is excluded. The remaining fully funded package with the most population-weighted votes wins at any vote share. There is no current-policy fallback.'
        : 'A package passes only with more than 50% of the population-weighted vote. Otherwise the exact current-tax, current-benefit policy with current AI pace remains.');
    el('agenda-order').textContent =
      (current.statusQuoUnavailable
        ? 'Exact ties use a deterministic hash of policy terms; policy names have no priority. '
        : 'Personal indifference favors eligible current policy; other ties use a deterministic hash of policy terms. ') +
      'Compromises are considered by a conservative estimate of their benefiting coalition, not their names. Voters can also withdraw support to restore current policy by abstaining; abstention never lowers the majority threshold. A cycle or 64 switches invokes a rule selecting a funded recorded outcome with the smallest strongest-challenger support, then the most ballot support. Exact ties use a policy-terms hash. Stability is checked under this protocol, not every possible bargaining arrangement. Perfect rationality alone does not select a unique equilibrium. ' +
      (current.mode === 'strategic'
        ? 'The foreign actor anticipates US compromise voting. Mutually consistent choices are preferred; otherwise the fixed international resolution rule selects a pair. ' +
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
    el('deviation').classList.remove('unstable');
    this.renderTrade();
    el('deviation').textContent = verified
      ? 'The choices are mutually consistent under the stated US coordination rule: this foreign package maximizes its objective among fully funded options given the enacted US package, and the US ballot gives the displayed result given this foreign package.'
      : current.search.reason + (current.foreignBestResponseGain !== undefined && current.foreignBestResponseGain > 0
          ? ' The foreign actor still has a profitable deviation; this pair is a scenario selected by the rule, not an equilibrium.' : '');
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
