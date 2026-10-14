export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export interface ProcessStage {
  label: string
  copy: string
}

export interface PaymentSchedule {
  label: string
  percent: number
  trigger: string
}

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          user_id: string
          role: 'customer' | 'ops' | 'partner' | 'operator'
          full_name: string | null
          phone: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          role?: 'customer' | 'ops' | 'partner' | 'operator'
          full_name?: string | null
          phone?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          user_id?: string
          role?: 'customer' | 'ops' | 'partner' | 'operator'
          full_name?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profile_builders: {
        Row: {
          profile_id: string
          builder_id: string
          created_at: string
        }
        Insert: {
          profile_id: string
          builder_id: string
          created_at?: string
        }
        Update: {
          profile_id?: string
          builder_id?: string
        }
        Relationships: []
      }
      operators: {
        Row: {
          id: string
          slug: string
          name: string
          brand: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          slug: string
          name: string
          brand?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          slug?: string
          name?: string
          brand?: Json
          updated_at?: string
        }
        Relationships: []
      }
      builders: {
        Row: {
          id: string
          operator_id: string
          slug: string
          name: string
          legal_name: string | null
          active: boolean
          sort: number
          stripe_account_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          operator_id: string
          slug: string
          name: string
          legal_name?: string | null
          active?: boolean
          sort?: number
          stripe_account_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          operator_id?: string
          slug?: string
          name?: string
          legal_name?: string | null
          active?: boolean
          sort?: number
          stripe_account_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      builder_brand: {
        Row: {
          builder_id: string
          logo_url: string | null
          wordmark_text: string | null
          color_accent: string
          color_bg: string
          color_text: string
          font_display: string
          font_body: string
          tagline: string | null
          hero_copy: string | null
          process_copy: ProcessStage[]
          custom_domain: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          builder_id: string
          logo_url?: string | null
          wordmark_text?: string | null
          color_accent?: string
          color_bg?: string
          color_text?: string
          font_display?: string
          font_body?: string
          tagline?: string | null
          hero_copy?: string | null
          process_copy?: ProcessStage[]
          custom_domain?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          logo_url?: string | null
          wordmark_text?: string | null
          color_accent?: string
          color_bg?: string
          color_text?: string
          font_display?: string
          font_body?: string
          tagline?: string | null
          hero_copy?: string | null
          process_copy?: ProcessStage[]
          custom_domain?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      builder_terms: {
        Row: {
          builder_id: string
          reservation_cents: number
          payment_schedule: PaymentSchedule[]
          warranty_text: string | null
          governing_law: string | null
          lead_time_copy: string | null
          currency: string
          payment_mode: 'none' | 'stripe'
          created_at: string
          updated_at: string
        }
        Insert: {
          builder_id: string
          reservation_cents?: number
          payment_schedule?: PaymentSchedule[]
          warranty_text?: string | null
          governing_law?: string | null
          lead_time_copy?: string | null
          currency?: string
          payment_mode?: 'none' | 'stripe'
          created_at?: string
          updated_at?: string
        }
        Update: {
          reservation_cents?: number
          payment_schedule?: PaymentSchedule[]
          warranty_text?: string | null
          governing_law?: string | null
          lead_time_copy?: string | null
          currency?: string
          payment_mode?: 'none' | 'stripe'
          updated_at?: string
        }
        Relationships: []
      }
      contract_templates: {
        Row: {
          id: string
          builder_id: string
          version: number
          title: string
          body_markdown: string
          merge_fields: string[]
          is_current: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          builder_id: string
          version: number
          title: string
          body_markdown: string
          merge_fields?: string[]
          is_current?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          builder_id?: string
          version?: number
          title?: string
          body_markdown?: string
          merge_fields?: string[]
          is_current?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          id: string
          profile_id: string | null
          address: Json | null
          source: 'web' | 'humble_house' | 'referral' | null
          email: string | null
          full_name: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          profile_id?: string | null
          address?: Json | null
          source?: 'web' | 'humble_house' | 'referral' | null
          email?: string | null
          full_name?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          profile_id?: string | null
          address?: Json | null
          source?: 'web' | 'humble_house' | 'referral' | null
          email?: string | null
          full_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      catalog_platforms: {
        Row: {
          id: string
          builder_id: string
          slug: string
          name: string
          chassis: string
          years: string
          hero_image_url: string | null
          sort: number
          active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          builder_id: string
          slug: string
          name: string
          chassis: string
          years: string
          hero_image_url?: string | null
          sort?: number
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          builder_id?: string
          slug?: string
          name?: string
          chassis?: string
          years?: string
          hero_image_url?: string | null
          sort?: number
          active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      catalog_tiers: {
        Row: {
          id: string
          builder_id: string
          slug: string
          name: string
          base_price_cents: number | null
          lead_time_weeks: number | null
          description: string | null
          quote_only: boolean
          sort: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          builder_id: string
          slug: string
          name: string
          base_price_cents?: number | null
          lead_time_weeks?: number | null
          description?: string | null
          quote_only?: boolean
          sort?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          builder_id?: string
          slug?: string
          name?: string
          base_price_cents?: number | null
          lead_time_weeks?: number | null
          description?: string | null
          quote_only?: boolean
          sort?: number
          updated_at?: string
        }
        Relationships: []
      }
      catalog_option_groups: {
        Row: {
          id: string
          builder_id: string
          platform_id: string | null
          slug: string
          name: string
          selection: 'single' | 'multi'
          required: boolean
          sort: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          builder_id: string
          platform_id?: string | null
          slug: string
          name: string
          selection?: 'single' | 'multi'
          required?: boolean
          sort?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          builder_id?: string
          platform_id?: string | null
          slug?: string
          name?: string
          selection?: 'single' | 'multi'
          required?: boolean
          sort?: number
          updated_at?: string
        }
        Relationships: []
      }
      catalog_options: {
        Row: {
          id: string
          builder_id: string
          group_id: string
          slug: string
          name: string
          code: string | null
          price_cents: number
          included_in_tier_ids: string[]
          swatch_image_url: string | null
          sort: number
          active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          builder_id: string
          group_id: string
          slug: string
          name: string
          code?: string | null
          price_cents?: number
          included_in_tier_ids?: string[]
          swatch_image_url?: string | null
          sort?: number
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          builder_id?: string
          group_id?: string
          slug?: string
          name?: string
          code?: string | null
          price_cents?: number
          included_in_tier_ids?: string[]
          swatch_image_url?: string | null
          sort?: number
          active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      catalog_option_platforms: {
        Row: {
          option_id: string
          platform_id: string
        }
        Insert: {
          option_id: string
          platform_id: string
        }
        Update: {
          option_id?: string
          platform_id?: string
        }
        Relationships: []
      }
      catalog_platform_gallery: {
        Row: {
          id: string
          builder_id: string
          platform_id: string
          image_url: string
          caption: string | null
          sort: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          builder_id: string
          platform_id: string
          image_url: string
          caption?: string | null
          sort?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          builder_id?: string
          platform_id?: string
          image_url?: string
          caption?: string | null
          sort?: number
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      auth_is_ops: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      auth_is_operator: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      auth_can_write_builder: {
        Args: { target_builder: string }
        Returns: boolean
      }
      auth_customer_id: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export type Platform = Database['public']['Tables']['catalog_platforms']['Row']
export type Tier = Database['public']['Tables']['catalog_tiers']['Row']
export type OptionGroup = Database['public']['Tables']['catalog_option_groups']['Row']
export type CatalogOption = Database['public']['Tables']['catalog_options']['Row']
export type Profile = Database['public']['Tables']['profiles']['Row']
export type Operator = Database['public']['Tables']['operators']['Row']
export type Builder = Database['public']['Tables']['builders']['Row']
export type BuilderBrand = Database['public']['Tables']['builder_brand']['Row']
export type BuilderTerms = Database['public']['Tables']['builder_terms']['Row']
export type ContractTemplate = Database['public']['Tables']['contract_templates']['Row']
