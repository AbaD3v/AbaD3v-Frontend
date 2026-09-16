export type TeamMember = {
  /** Stable key used by React and for selecting a member in the team constellation. */
  id: string;
  name: string;
  role: string;
  initials: string;
  github: string;
  avatar: string;
  lead?: boolean;
};
