import abzalM from './members/abzal-m';
import ayadilM from './members/ayadil-m';
import beibarysM from './members/beibarys-m';
import ersultanK from './members/ersultan-k';
import rasulK from './members/rasul-k';
import type { TeamMember } from './types';

/**
 * The order here is the presentation order on the team page.
 * Edit a member's own file in `members/`; only change this list to reorder people.
 */
export const team: TeamMember[] = [abzalM, ersultanK, ayadilM, rasulK, beibarysM];

export type { TeamMember };
