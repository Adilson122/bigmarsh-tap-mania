export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      admin_sessions: {
        Row: {
          created_at: string
          expires_at: string
          revoked: boolean
          telegram_id: number | null
          token: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          revoked?: boolean
          telegram_id?: number | null
          token: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          revoked?: boolean
          telegram_id?: number | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_sessions_telegram_id_fkey"
            columns: ["telegram_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["telegram_id"]
          },
        ]
      }
      app_settings: {
        Row: {
          id: number
          ton_receiver_address: string
          updated_at: string
        }
        Insert: {
          id?: number
          ton_receiver_address?: string
          updated_at?: string
        }
        Update: {
          id?: number
          ton_receiver_address?: string
          updated_at?: string
        }
        Relationships: []
      }
      monetization_passes: {
        Row: {
          benefits: string
          created_at: string
          duration_days: number
          id: string
          is_enabled: boolean
          is_visible: boolean
          pass_type: string
          price_ton: number
          price_usd: number
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          benefits?: string
          created_at?: string
          duration_days: number
          id?: string
          is_enabled?: boolean
          is_visible?: boolean
          pass_type: string
          price_ton?: number
          price_usd: number
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          benefits?: string
          created_at?: string
          duration_days?: number
          id?: string
          is_enabled?: boolean
          is_visible?: boolean
          pass_type?: string
          price_ton?: number
          price_usd?: number
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      pass_purchases: {
        Row: {
          amount_nano: number
          amount_ton: number
          created_at: string
          expires_at: string
          id: string
          paid_at: string | null
          pass_type: string
          payment_comment: string
          recipient_address: string
          status: Database["public"]["Enums"]["purchase_status"]
          tx_hash: string | null
          user_id: number
        }
        Insert: {
          amount_nano: number
          amount_ton: number
          created_at?: string
          expires_at?: string
          id?: string
          paid_at?: string | null
          pass_type: string
          payment_comment: string
          recipient_address: string
          status?: Database["public"]["Enums"]["purchase_status"]
          tx_hash?: string | null
          user_id: number
        }
        Update: {
          amount_nano?: number
          amount_ton?: number
          created_at?: string
          expires_at?: string
          id?: string
          paid_at?: string | null
          pass_type?: string
          payment_comment?: string
          recipient_address?: string
          status?: Database["public"]["Enums"]["purchase_status"]
          tx_hash?: string | null
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "pass_purchases_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["telegram_id"]
          },
        ]
      }
      referrals: {
        Row: {
          created_at: string
          id: string
          notified_at: string | null
          referred_id: number
          referrer_id: number
        }
        Insert: {
          created_at?: string
          id?: string
          notified_at?: string | null
          referred_id: number
          referrer_id: number
        }
        Update: {
          created_at?: string
          id?: string
          notified_at?: string | null
          referred_id?: number
          referrer_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "referrals_referred_id_fkey"
            columns: ["referred_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["telegram_id"]
          },
          {
            foreignKeyName: "referrals_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["telegram_id"]
          },
        ]
      }
      task_completions: {
        Row: {
          completed_at: string
          id: string
          task_id: string
          user_id: number
        }
        Insert: {
          completed_at?: string
          id?: string
          task_id: string
          user_id: number
        }
        Update: {
          completed_at?: string
          id?: string
          task_id?: string
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "task_completions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_completions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["telegram_id"]
          },
        ]
      }
      task_settings: {
        Row: {
          created_at: string
          id: number
          referral_goal: number
          referral_reward_bmh: number
          tap_goal: number
          tap_reward_bmh: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: number
          referral_goal?: number
          referral_reward_bmh?: number
          tap_goal?: number
          tap_reward_bmh?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: number
          referral_goal?: number
          referral_reward_bmh?: number
          tap_goal?: number
          tap_reward_bmh?: number
          updated_at?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          active_date: string
          completed_by_user: boolean
          created_at: string
          description: string | null
          id: string
          kind: Database["public"]["Enums"]["task_kind"]
          link_url: string | null
          reward_bmh: number
          target_value: number | null
          title: string
        }
        Insert: {
          active_date?: string
          completed_by_user?: boolean
          created_at?: string
          description?: string | null
          id?: string
          kind: Database["public"]["Enums"]["task_kind"]
          link_url?: string | null
          reward_bmh: number
          target_value?: number | null
          title: string
        }
        Update: {
          active_date?: string
          completed_by_user?: boolean
          created_at?: string
          description?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["task_kind"]
          link_url?: string | null
          reward_bmh?: number
          target_value?: number | null
          title?: string
        }
        Relationships: []
      }
      upgrades: {
        Row: {
          id: string
          level: number
          upgrade_type: string
          user_id: number
        }
        Insert: {
          id?: string
          level?: number
          upgrade_type: string
          user_id: number
        }
        Update: {
          id?: string
          level?: number
          upgrade_type?: string
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "upgrades_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["telegram_id"]
          },
        ]
      }
      user_ad_slots: {
        Row: {
          cycle_no: number
          kind: Database["public"]["Enums"]["task_kind"]
          next_available_at: string
          reward_bmh: number
          slot_no: number
          updated_at: string
          user_id: number
        }
        Insert: {
          cycle_no?: number
          kind: Database["public"]["Enums"]["task_kind"]
          next_available_at?: string
          reward_bmh: number
          slot_no: number
          updated_at?: string
          user_id: number
        }
        Update: {
          cycle_no?: number
          kind?: Database["public"]["Enums"]["task_kind"]
          next_available_at?: string
          reward_bmh?: number
          slot_no?: number
          updated_at?: string
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_ad_slots_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["telegram_id"]
          },
        ]
      }
      user_passes: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          pass_type: string
          source_purchase_id: string | null
          starts_at: string
          user_id: number
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          pass_type: string
          source_purchase_id?: string | null
          starts_at?: string
          user_id: number
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          pass_type?: string
          source_purchase_id?: string | null
          starts_at?: string
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_passes_source_purchase_id_fkey"
            columns: ["source_purchase_id"]
            isOneToOne: false
            referencedRelation: "pass_purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_passes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["telegram_id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: number
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: number
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["telegram_id"]
          },
        ]
      }
      user_wallets: {
        Row: {
          connected_at: string
          updated_at: string
          user_id: number
          wallet_address: string
          wallet_provider: string
        }
        Insert: {
          connected_at?: string
          updated_at?: string
          user_id: number
          wallet_address: string
          wallet_provider?: string
        }
        Update: {
          connected_at?: string
          updated_at?: string
          user_id?: number
          wallet_address?: string
          wallet_provider?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_wallets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["telegram_id"]
          },
        ]
      }
      users: {
        Row: {
          avatar_url: string | null
          bmh_balance: number
          combo_count: number
          created_at: string
          daily_streak: number
          energy: number
          first_name: string | null
          is_banned: boolean
          last_energy_at: string
          last_login: string | null
          last_tap: string | null
          level: number
          max_energy: number
          referrals_count: number
          telegram_id: number
          total_referral_reward: number
          total_taps: number
          updated_at: string
          username: string | null
          weekly_bmh: number
          weekly_reset_at: string
        }
        Insert: {
          avatar_url?: string | null
          bmh_balance?: number
          combo_count?: number
          created_at?: string
          daily_streak?: number
          energy?: number
          first_name?: string | null
          is_banned?: boolean
          last_energy_at?: string
          last_login?: string | null
          last_tap?: string | null
          level?: number
          max_energy?: number
          referrals_count?: number
          telegram_id: number
          total_referral_reward?: number
          total_taps?: number
          updated_at?: string
          username?: string | null
          weekly_bmh?: number
          weekly_reset_at?: string
        }
        Update: {
          avatar_url?: string | null
          bmh_balance?: number
          combo_count?: number
          created_at?: string
          daily_streak?: number
          energy?: number
          first_name?: string | null
          is_banned?: boolean
          last_energy_at?: string
          last_login?: string | null
          last_tap?: string | null
          level?: number
          max_energy?: number
          referrals_count?: number
          telegram_id?: number
          total_referral_reward?: number
          total_taps?: number
          updated_at?: string
          username?: string | null
          weekly_bmh?: number
          weekly_reset_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      buy_upgrade: {
        Args: { _telegram_id: number; _upgrade_type: string }
        Returns: {
          new_balance: number
          new_level: number
          ok: boolean
        }[]
      }
      claim_ad_slot: {
        Args: { _slot_no: number; _telegram_id: number }
        Returns: {
          new_balance: number
          ok: boolean
          reward: number
        }[]
      }
      claim_task: {
        Args: { _task_id: string; _telegram_id: number }
        Returns: {
          new_balance: number
          ok: boolean
          reward: number
        }[]
      }
      compute_regen:
        | {
            Args: {
              _energy: number
              _last_energy_at: string
              _max_energy: number
            }
            Returns: {
              new_energy: number
              new_last_energy_at: string
            }[]
          }
        | {
            Args: {
              _energy: number
              _last_energy_at: string
              _max_energy: number
              _regen_interval_seconds?: number
            }
            Returns: {
              new_energy: number
              new_last_energy_at: string
            }[]
          }
      confirm_pass_checkout: {
        Args: { _purchase_id: string; _telegram_id: number; _tx_hash?: string }
        Returns: Json
      }
      connect_user_wallet: {
        Args: { _telegram_id: number; _wallet_address: string }
        Returns: string
      }
      create_pass_checkout: {
        Args: { _pass_type: string; _telegram_id: number }
        Returns: Json
      }
      ensure_daily_tasks: { Args: never; Returns: undefined }
      ensure_user_ad_slots: {
        Args: { _telegram_id: number }
        Returns: undefined
      }
      get_admin_stats: { Args: never; Returns: Json }
      get_leaderboard: {
        Args: { _scope?: string; _telegram_id: number }
        Returns: {
          avatar_url: string
          bmh_balance: number
          first_name: string
          rank_no: number
          telegram_id: number
          username: string
          weekly_bmh: number
        }[]
      }
      get_state: { Args: { _telegram_id: number }; Returns: Json }
      get_user_pass_effects: {
        Args: { _telegram_id: number }
        Returns: {
          referral_bonus_multiplier: number
          regen_interval_seconds: number
          reward_multiplier: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: number
        }
        Returns: boolean
      }
      tap_marsh: {
        Args: { _tap_at?: string; _telegram_id: number }
        Returns: {
          bmh_balance: number
          combo: number
          earned_bmh: number
          energy: number
          level: number
          next_regen_in: number
        }[]
      }
      tg_auth_upsert: {
        Args: {
          _avatar_url: string
          _first_name: string
          _start_param?: string
          _telegram_id: number
          _username: string
        }
        Returns: {
          avatar_url: string | null
          bmh_balance: number
          combo_count: number
          created_at: string
          daily_streak: number
          energy: number
          first_name: string | null
          is_banned: boolean
          last_energy_at: string
          last_login: string | null
          last_tap: string | null
          level: number
          max_energy: number
          referrals_count: number
          telegram_id: number
          total_referral_reward: number
          total_taps: number
          updated_at: string
          username: string | null
          weekly_bmh: number
          weekly_reset_at: string
        }
        SetofOptions: {
          from: "*"
          to: "users"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      purchase_status: "pending" | "paid" | "expired" | "failed"
      task_kind:
        | "taps_500"
        | "invite_1"
        | "watch_ad"
        | "ad_watch"
        | "link_visit"
        | "weekly_bmh"
        | "weekly_invite"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
      purchase_status: ["pending", "paid", "expired", "failed"],
      task_kind: [
        "taps_500",
        "invite_1",
        "watch_ad",
        "ad_watch",
        "link_visit",
        "weekly_bmh",
        "weekly_invite",
      ],
    },
  },
} as const
