export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      signals: {
        Row: {
          id: string;
          opportunity_id: string | null;
          symbol: string;
          direction: string;
          signal_type: string;
          lifecycle_status: string;
          level: string;
          score: number;
          entry_mode: string;
          entry_low: number | null;
          entry_high: number | null;
          trigger_price: number | null;
          mark_price: number | null;
          stop_loss: number | null;
          tp1: number | null;
          tp2: number | null;
          tp3: number | null;
          theoretical_rr: number | null;
          weighted_rr: number | null;
          cost_adjusted_rr: number | null;
          sl_distance_pct: number | null;
          sl_atr_ratio: number | null;
          btc_state: string | null;
          market_regime: string | null;
          funding_rate: number | null;
          funding_percentile: number | null;
          oi_change_15m: number | null;
          oi_percentile: number | null;
          relative_strength_score: number | null;
          liquidity_score: number | null;
          data_quality_score: number | null;
          reasons: Json;
          invalidation_rules: Json;
          no_chase_rule: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
      };
    };
  };
};

