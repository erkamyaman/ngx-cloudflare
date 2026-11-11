export interface Entry {
  id: number;
  name: string;
  message: string;
  created_at: string;
}

export const ENTRY_LIMITS = { name: 60, message: 500 } as const;
