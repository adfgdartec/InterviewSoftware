/**
 * Anchored rubrics. Spec §2.6: every dimension has a 1-5 scale where each level carries a
 * written behavioural anchor and two worked examples. The audited prototype instead applied
 * an arbitrary 15% penalty and labelled 70+ "exceptional"; nothing here rescales to 0-100.
 *
 * Anchors describe what the candidate DID or SAID. They never describe an inferred internal
 * state, which is both a legal requirement (spec §5.1) and a measurement one: an interviewer
 * can verify "named two failure modes and gave a detection signal for each" from a
 * transcript, and cannot verify "seemed unsure".
 *
 * SCOPE NOTE: four rubrics here are cross-cutting (warmup, behavioral, situational, closing)
 * because STAR narrative quality does not change with the candidate's specialization. The
 * domain rubric is currently shared as well: it grades reasoning quality, with the domain
 * itself supplied by the item bank. Spec §2.4 calls for per-track domain rubrics; the
 * remaining eleven are recorded in docs/DELIVERY.md under Known Gaps rather than stubbed.
 */

import type { Rubric, RubricAnchor, RubricDimension } from './catalog-types.js';

function anchors(
  levels: readonly [string, string, string][],
): readonly RubricAnchor[] {
  return levels.map((entry, index) => {
    const [anchor, workedExampleA, workedExampleB] = entry;
    return { level: (index + 1) as RubricAnchor['level'], anchor, workedExampleA, workedExampleB };
  });
}

function dimension(
  id: string,
  name: string,
  description: string,
  levels: readonly [string, string, string][],
): RubricDimension {
  return { id, name, description, anchors: anchors(levels) };
}

const SCOPING = dimension(
  'scoping',
  'Requirement scoping',
  'Whether the candidate established constraints before proposing a solution.',
  [
    ['Began solving immediately; stated no constraint and asked no question.',
     'Started writing an approach in the first fifteen seconds.',
     'Never established scale, latency budget, or who the user is.'],
    ['Asked one clarifying question, then proceeded regardless of the answer.',
     'Asked about data volume, then used an approach that ignored the answer given.',
     'Restated the prompt back without adding a constraint.'],
    ['Established the two or three constraints that bound the problem before designing.',
     'Asked for request volume, acceptable latency, and consistency requirements.',
     'Wrote the constraints down and referred back to them once.'],
    ['Established constraints and stated explicitly which ones drive the design.',
     'Said the p99 latency budget, not the data volume, is what rules out the naive approach.',
     'Named an assumption and flagged it as the thing to verify first.'],
    ['Established constraints, ranked them, and identified the one whose change would most alter the design.',
     'Said the design holds to 10x volume but is rewritten if the consistency requirement tightens.',
     'Separated stated requirements from inferred ones and checked the inferred ones.'],
  ],
);

const MECHANISM = dimension(
  'mechanism',
  'Mechanism-level explanation',
  'Whether claims are explained at the level of what actually happens, or only named.',
  [
    ['Named components without saying what they do.',
     'Said "add a cache" with no statement of what is cached or when it is invalidated.',
     'Listed three technologies and moved on.'],
    ['Explained one step mechanically; the rest stayed at the level of names.',
     'Described the write path in detail but left the read path as "it reads from the store".',
     'Explained what a queue is without saying what it decouples here.'],
    ['Explained the main path at the level of data movement and state changes.',
     'Traced a request end to end, naming what is written and what is read at each hop.',
     'Said which step is synchronous and which is deferred, and why.'],
    ['Explained the main path mechanically and identified where it breaks down.',
     'Traced the path, then said the coordinator becomes the bottleneck above N workers.',
     'Gave a quantity -- bytes moved, round trips, memory held -- for the dominant step.'],
    ['Explained the mechanism and derived a quantitative consequence from it.',
     'Computed bytes per step and showed the design is bandwidth-bound, not compute-bound.',
     'Predicted the observable symptom the bottleneck would produce in a metric.'],
  ],
);

const TRADEOFFS = dimension(
  'tradeoffs',
  'Trade-off articulation',
  'Whether alternatives were compared on a stated axis rather than asserted.',
  [
    ['Presented one option as correct with no alternative considered.',
     'Chose an approach and never mentioned another existed.',
     'Dismissed an alternative without giving a reason.'],
    ['Mentioned an alternative but gave no basis for preferring one.',
     'Said "we could also do X" and moved on without comparing.',
     'Compared on popularity rather than on a property of the problem.'],
    ['Compared two options on at least one concrete axis.',
     'Compared on write amplification and chose accordingly.',
     'Said the alternative costs more memory but less latency, and picked one.'],
    ['Compared on the axis that the stated constraints actually make decisive.',
     'Chose the higher-memory option because the constraint given was latency, not cost.',
     'Said the comparison would invert if the read/write ratio flipped.'],
    ['Compared on the decisive axis and named the condition under which the choice reverses.',
     'Gave the ratio at which the two designs cross over and how to measure it.',
     'Identified which trade-off is reversible later and which is not.'],
  ],
);

const FAILURE_MODES = dimension(
  'failure_modes',
  'Failure-mode reasoning',
  'Whether the candidate anticipated how the design fails and how failure is detected.',
  [
    ['Did not raise a failure mode.',
     'Described only the path where everything works.',
     'Said "it should be fine" when asked what breaks.'],
    ['Named a failure mode without a detection or mitigation.',
     'Said the database could go down, with no follow-up.',
     'Mentioned retries without saying what makes them safe.'],
    ['Named a failure mode with a mitigation.',
     'Said a stalled worker is handled by a heartbeat and reassignment.',
     'Identified the retry-storm risk and applied backoff.'],
    ['Named failure modes with both a detection signal and a mitigation.',
     'Said the symptom is rising queue depth with flat throughput, detected on that metric.',
     'Distinguished a failure that degrades from one that corrupts.'],
    ['Anticipated the failure mode specific to this design, not to systems generally.',
     'Identified that this particular sharding scheme makes one key a hot spot under skew.',
     'Named the failure the chosen trade-off introduced, and how to bound its blast radius.'],
  ],
);

const STAR_COVERAGE = dimension(
  'star_coverage',
  'STAR segment coverage',
  'Whether situation, task, action and result were all present and distinguishable.',
  [
    ['Gave a general description of a kind of work rather than one specific instance.',
     'Talked about "how we usually handled outages" without a single incident.',
     'Answered in the second person about what one should do.'],
    ['Told one instance but only one or two STAR segments were present.',
     'Described the situation at length and never said what they personally did.',
     'Gave the action with no result.'],
    ['All four segments present, though some were thin.',
     'Situation, task, action and result each identifiable in the answer.',
     'Result stated but not quantified.'],
    ['All four segments present, with the action segment clearly the candidate’s own work.',
     'Said "I" for the actions they took and "we" for the team’s, distinguishably.',
     'Result tied causally back to the specific action described.'],
    ['All four present, action attributed precisely, and the result quantified and attributed.',
     'Gave a before-and-after number and said how it was measured.',
     'Named their own contribution’s share of a team outcome without overclaiming.'],
  ],
);

const QUANTIFICATION = dimension(
  'quantification',
  'Quantified outcome',
  'Whether outcomes carry numbers and a stated measurement basis (spec §2.8).',
  [
    ['No quantity anywhere in the answer.',
     'Said the change "made things much faster".',
     'Described impact only as "significant".'],
    ['A quantity was given but not connected to the action described.',
     'Cited team headcount but no measure of the outcome.',
     'Gave a number with no unit or baseline.'],
    ['Gave at least one quantified outcome with a unit.',
     'Said p99 latency fell from 800ms to 240ms.',
     'Gave a throughput figure before and after.'],
    ['Quantified the outcome and stated how it was measured.',
     'Gave the metric, the measurement window, and the baseline period.',
     'Distinguished the measured effect from concurrent changes.'],
    ['Quantified the outcome, stated the measurement basis, and bounded the claim.',
     'Gave the figure and said which portion was attributable to their change.',
     'Named the confounder and what was done to rule it out.'],
  ],
);

const STRUCTURE = dimension(
  'structure',
  'Answer structure',
  'Whether the answer opened with its point and stayed navigable.',
  [
    ['No discernible structure; the point never arrived.',
     'Spoke for two minutes without stating a conclusion.',
     'Restarted the answer twice with different framings.'],
    ['Point arrived only at the very end after unstructured narration.',
     'Buried the conclusion in the final sentence.',
     'Listed events chronologically with no summary.'],
    ['Opened with the point, then supported it.',
     'Led with the outcome and then explained how it was reached.',
     'Used an explicit "three things" structure and kept to it.'],
    ['Opened with the point, supported it, and closed by returning to it.',
     'Stated the claim, gave two pieces of evidence, restated the claim.',
     'Signposted transitions so the listener could follow without notes.'],
    ['Structured the answer to the question actually asked, and adjusted when redirected.',
     'Compressed the setup when the interviewer signalled familiarity.',
     'Reordered to lead with the part the follow-up question revealed mattered.'],
  ],
);

const SPECIFICITY = dimension(
  'specificity',
  'Concrete detail',
  'Whether the answer contains verifiable specifics rather than generalities.',
  [
    ['Entirely general; nothing that could be checked.',
     'Described best practices rather than what happened.',
     'No system, tool, scale or date named.'],
    ['One concrete detail; the rest general.',
     'Named the language used but nothing about the problem.',
     'Gave a company name and no technical specifics.'],
    ['Several concrete, checkable details.',
     'Named the system, the scale, and the constraint that made it hard.',
     'Described the specific bug and the specific fix.'],
    ['Concrete throughout, including details that only a participant would know.',
     'Described the false start before the fix that worked.',
     'Named the constraint that made the obvious approach unavailable.'],
    ['Concrete throughout and calibrated: distinguished what was certain from what was recalled.',
     'Said which figure was exact and which was approximate.',
     'Corrected an overstatement without being prompted.'],
  ],
);

const CODE_CORRECTNESS = dimension(
  'correctness',
  'Correctness',
  'Whether the solution produces correct output, including on boundary inputs.',
  [
    ['Solution does not run, or fails the stated example.',
     'Syntax error left unresolved.',
     'Returns the wrong answer on the worked example given in the prompt.'],
    ['Runs and handles the happy path only.',
     'Correct on the example, wrong on an empty input.',
     'Off-by-one at the final element.'],
    ['Correct on the happy path and the obvious boundaries.',
     'Handled empty input and a single-element input.',
     'Passed the visible tests and most hidden ones.'],
    ['Correct on all tested inputs, with boundaries handled deliberately.',
     'Wrote the empty-input guard before being asked about it.',
     'Named the boundary case aloud and then covered it.'],
    ['Correct throughout, with the boundary reasoning stated as an invariant.',
     'Stated the loop invariant and showed the boundary follows from it.',
     'Identified an input class the naive solution breaks on and handled it.'],
  ],
);

const COMPLEXITY = dimension(
  'complexity',
  'Complexity reasoning',
  'Whether time and space cost were derived rather than recited.',
  [
    ['No complexity statement offered or attempted.',
     'Could not say how the runtime scales when asked.',
     'Gave a complexity that does not match the code written.'],
    ['Stated a complexity but could not justify it.',
     'Said O(n log n) without identifying the log factor.',
     'Ignored the cost of an inner operation.'],
    ['Stated correct time complexity with a brief justification.',
     'Pointed at the sort as the dominant term.',
     'Counted the nested loop correctly.'],
    ['Stated time and space correctly and identified the dominant term.',
     'Noted the recursion stack as the space cost.',
     'Distinguished average from worst case.'],
    ['Derived both, and identified what would have to change to improve the bound.',
     'Said the sort is the floor unless the input is bounded, then it is counting sort.',
     'Traded space for time explicitly and stated the new bound.'],
  ],
);

const TESTING_INSTINCT = dimension(
  'testing_instinct',
  'Testing instinct',
  'Whether the candidate proposed tests before being asked to.',
  [
    ['Proposed no tests, even when prompted.',
     'Said the code "looks right" when asked how to verify it.',
     'Declined to trace an input through.'],
    ['Proposed a test only after being asked.',
     'Ran the provided example when prompted.',
     'Named one test case, the same as the example.'],
    ['Proposed tests unprompted, covering the happy path and one edge.',
     'Wrote an empty-input case without being asked.',
     'Traced a small input by hand before declaring it done.'],
    ['Proposed tests spanning the boundary classes the solution has.',
     'Covered empty, single, duplicate and maximum-size inputs.',
     'Chose test inputs that would distinguish two plausible implementations.'],
    ['Proposed tests that target the specific way this solution could be wrong.',
     'Wrote a case aimed at the off-by-one the chosen loop form invites.',
     'Named a property that should hold for all inputs and tested it.'],
  ],
);

const HINT_DEPENDENCE = dimension(
  'hint_dependence',
  'Hint dependence',
  'How much interviewer scaffolding the candidate required (spec §2.2). Lower dependence scores higher.',
  [
    ['Required a partial solution before progress resumed.',
     'Made no progress until the structure was supplied.',
     'Needed the algorithm named outright.'],
    ['Required a structural hint to reach the approach.',
     'Progressed only after being told which data structure to reach for.',
     'Needed the problem restated in a different framing.'],
    ['Required a constraint-level nudge.',
     'Moved forward once reminded of the input size bound.',
     'Needed one pointer toward the part of the problem that mattered.'],
    ['Required only a light nudge, and extended it independently.',
     'Took a one-word prompt and derived the rest.',
     'Used the nudge and then found a second improvement unaided.'],
    ['Reached and refined the solution without scaffolding.',
     'Arrived at the approach unaided and improved it after self-critique.',
     'Rejected their own first approach with a stated reason before any prompt.'],
  ],
);

const CAPACITY = dimension(
  'capacity_estimation',
  'Capacity estimation',
  'Whether the design was sized with arithmetic rather than asserted.',
  [
    ['No sizing attempted.',
     'Proposed a design without any volume figure.',
     'Said "it will scale" with no basis.'],
    ['Quoted a number without deriving it.',
     'Asserted a QPS figure with no arithmetic.',
     'Gave storage size without stating the per-record assumption.'],
    ['Derived one sizing figure from stated assumptions.',
     'Computed daily writes from users times actions.',
     'Estimated storage from record size times retention.'],
    ['Derived the sizings that determine the architecture.',
     'Showed the working set does not fit in memory, forcing the tiering decision.',
     'Sized both the steady state and the peak.'],
    ['Derived sizings and used them to eliminate a design.',
     'Showed the single-node option fails at the stated volume, with the arithmetic.',
     'Identified which assumption the estimate is most sensitive to.'],
  ],
);

const rubric = (
  id: string,
  trackId: string,
  roundType: Rubric['roundType'],
  name: string,
  dimensions: readonly RubricDimension[],
): Rubric => ({ id, trackId, roundType, name, version: 1, dimensions });

export const RUBRICS: readonly Rubric[] = [
  rubric('shared.warmup.v1', 'shared', 'warmup', 'Opening narrative', [
    STRUCTURE, SPECIFICITY, QUANTIFICATION,
  ]),
  rubric('shared.domain.v1', 'shared', 'domain', 'Domain reasoning depth', [
    SCOPING, MECHANISM, TRADEOFFS, FAILURE_MODES,
  ]),
  rubric('shared.behavioral.v1', 'shared', 'behavioral', 'Behavioral evidence quality', [
    STAR_COVERAGE, QUANTIFICATION, SPECIFICITY, STRUCTURE,
  ]),
  rubric('shared.situational.v1', 'shared', 'situational', 'Situational judgement', [
    SCOPING, TRADEOFFS, STRUCTURE,
  ]),
  rubric('shared.closing.v1', 'shared', 'closing', 'Closing and candidate questions', [
    SPECIFICITY, STRUCTURE,
  ]),
  rubric('ml-systems.coding.v1', 'ml-systems', 'coding', 'Coding under interview conditions', [
    CODE_CORRECTNESS, COMPLEXITY, TESTING_INSTINCT, HINT_DEPENDENCE,
  ]),
  rubric('ml-systems.design.v1', 'ml-systems', 'design', 'Systems design', [
    SCOPING, CAPACITY, TRADEOFFS, FAILURE_MODES,
  ]),
];

export function rubricById(id: string): Rubric | undefined {
  return RUBRICS.find((r) => r.id === id);
}

/** Resolves the rubric for a round, preferring a track-specific one over the shared one. */
export function rubricFor(trackId: string, roundType: Rubric['roundType']): Rubric | undefined {
  return (
    RUBRICS.find((r) => r.trackId === trackId && r.roundType === roundType) ??
    RUBRICS.find((r) => r.trackId === 'shared' && r.roundType === roundType)
  );
}
