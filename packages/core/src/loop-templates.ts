/**
 * Loop templates. Spec §2.1: model the session as a loop containing rounds, each with a
 * type, a persona, a rubric and a time budget.
 *
 * Templates are named by FORMAT, never by employer. Spec §5.3 permits naming a company
 * descriptively to identify the format being emulated (nominative fair use) but forbids any
 * implication of affiliation, so the employer reference lives in `modeledOnNote` and
 * `sourceUrls` -- both of which are shown to the user -- and never in the template name.
 *
 * `sourceUrls` points at each company's public careers/interview-process area. Deep links to
 * specific pages rot; these are the stable roots, which is the honest citation to make.
 */

import { BRAND } from './brand.js';
import type { LoopTemplate, RoundSpec } from './catalog-types.js';

const DISCLAIMER =
  `Modeled on publicly reported interview formats. ${BRAND.name} is not affiliated with, ` +
  'endorsed by, or sponsored by any employer named here.';

const round = (
  position: number,
  roundType: RoundSpec['roundType'],
  persona: string,
  rubricId: string,
  minutes: number,
): RoundSpec => ({ position, roundType, persona, rubricId, minutes });

export const LOOP_TEMPLATES: readonly LoopTemplate[] = [
  {
    id: 'frontier-lab-ml-systems',
    name: 'Frontier lab ML systems loop',
    trackId: 'ml-systems',
    levelBand: 'L5',
    sourceUrls: ['https://www.anthropic.com/careers', 'https://openai.com/careers/'],
    modeledOnNote:
      `A research-depth screen followed by breadth, a pair-programming round on realistic ` +
      `code, and a systems round. ${DISCLAIMER}`,
    rounds: [
      round(1, 'warmup', 'Recruiter screen', 'shared.warmup.v1', 10),
      round(2, 'domain', 'Staff ML systems engineer', 'shared.domain.v1', 45),
      round(3, 'coding', 'Senior engineer, pair programming', 'ml-systems.coding.v1', 60),
      round(4, 'design', 'Principal engineer, systems', 'ml-systems.design.v1', 60),
      round(5, 'behavioral', 'Engineering manager', 'shared.behavioral.v1', 45),
    ],
  },
  {
    id: 'committee-reviewed-generalist',
    name: 'Committee-reviewed generalist loop',
    trackId: 'software-engineering',
    levelBand: 'L4',
    sourceUrls: ['https://www.google.com/about/careers/applications/how-we-hire/'],
    modeledOnNote:
      `A phone screen followed by a four-to-five round onsite, with the packet reviewed by a ` +
      `hiring committee rather than decided by the interviewers. ${DISCLAIMER}`,
    rounds: [
      round(1, 'warmup', 'Recruiter screen', 'shared.warmup.v1', 10),
      round(2, 'domain', 'Software engineer, phone screen', 'shared.domain.v1', 45),
      round(3, 'domain', 'Software engineer, onsite', 'shared.domain.v1', 45),
      round(4, 'situational', 'Cross-functional interviewer', 'shared.situational.v1', 30),
      round(5, 'closing', 'Hiring manager', 'shared.closing.v1', 15),
    ],
  },
  {
    id: 'leadership-principles-bar-raiser',
    name: 'Leadership-principles loop with a bar-raiser round',
    trackId: 'software-engineering',
    levelBand: 'L5',
    sourceUrls: ['https://www.amazon.jobs/content/en/how-we-hire/interviewing-at-amazon'],
    modeledOnNote:
      `An online assessment and phone screen followed by a four-to-six round loop in which ` +
      `every round probes documented leadership principles through STAR narratives with ` +
      `quantified outcomes, including one round held by an interviewer outside the hiring ` +
      `team. ${DISCLAIMER}`,
    rounds: [
      round(1, 'warmup', 'Recruiter screen', 'shared.warmup.v1', 10),
      round(2, 'behavioral', 'Hiring manager', 'shared.behavioral.v1', 45),
      round(3, 'domain', 'Senior engineer', 'shared.domain.v1', 45),
      round(4, 'behavioral', 'Bar-raiser, outside the hiring team', 'shared.behavioral.v1', 60),
      round(5, 'closing', 'Recruiter debrief', 'shared.closing.v1', 15),
    ],
  },
  {
    id: 'coding-design-behavioral-triad',
    name: 'Coding, design and behavioral triad',
    trackId: 'software-engineering',
    levelBand: 'L5',
    sourceUrls: ['https://www.metacareers.com/life/interviewing-at-meta/'],
    modeledOnNote:
      `A screen followed by coding rounds, a design round expected at senior levels, and a ` +
      `behavioral round. ${DISCLAIMER}`,
    rounds: [
      round(1, 'warmup', 'Recruiter screen', 'shared.warmup.v1', 10),
      round(2, 'domain', 'Software engineer, technical screen', 'shared.domain.v1', 45),
      round(3, 'domain', 'Software engineer, onsite', 'shared.domain.v1', 45),
      round(4, 'behavioral', 'Engineering manager', 'shared.behavioral.v1', 45),
    ],
  },
  {
    id: 'team-owned-domain-loop',
    name: 'Team-owned domain-specific loop',
    trackId: 'general',
    levelBand: 'L4',
    sourceUrls: ['https://jobs.careers.microsoft.com/', 'https://www.apple.com/careers/us/'],
    modeledOnNote:
      `A loop owned by the hiring team rather than a central process: deeper domain ` +
      `specificity, less standardization between teams. ${DISCLAIMER}`,
    rounds: [
      round(1, 'warmup', 'Hiring manager screen', 'shared.warmup.v1', 15),
      round(2, 'domain', 'Team engineer', 'shared.domain.v1', 45),
      round(3, 'situational', 'Team lead', 'shared.situational.v1', 30),
      round(4, 'closing', 'Hiring manager', 'shared.closing.v1', 15),
    ],
  },
];

export function loopTemplateById(id: string): LoopTemplate | undefined {
  return LOOP_TEMPLATES.find((t) => t.id === id);
}
