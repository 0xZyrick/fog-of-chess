import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://cfpdzroibqqwvlauaupj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_lf8M9kcsQf4uA4rxDYFLfQ_yw7sRTsE';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export interface MoveRecord {
  session_id: number;
  player: string;
  to_row: number;
  to_col: number;
  from_row: number;
  from_col: number;
  is_capture: boolean;
  move_count: number;
  proof_seal: string;
}

export const broadcastMove = async (move: MoveRecord) => {
  const { error } = await supabase.from('moves').insert(move);
  if (error) console.error('Failed to broadcast move:', error);
};

export const subscribeMoves = (
  sessionId: number,
  onMove: (move: MoveRecord) => void
) => {
  const channel = supabase
    .channel(`game-${sessionId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'moves',
        filter: `session_id=eq.${sessionId}`,
      },
      (payload) => onMove(payload.new as MoveRecord)
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
};
