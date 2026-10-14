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
          contact: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          slug: string
          name: string
          brand?: Json
          contact?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          slug?: string
          name?: string
          brand?: Json
          contact?: Json
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
          zoho_product_id: string | null
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
          zoho_product_id?: string | null
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
          zoho_product_id?: string | null
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
          enquire_url: string
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
          enquire_url?: string
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
          enquire_url?: string
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
          option_mode: 'included_only' | 'priced'
          quote_validity_days: number
          quote_intro_copy: string | null
          brochure_url: string | null
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
          option_mode?: 'included_only' | 'priced'
          quote_validity_days?: number
          quote_intro_copy?: string | null
          brochure_url?: string | null
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
          option_mode?: 'included_only' | 'priced'
          quote_validity_days?: number
          quote_intro_copy?: string | null
          brochure_url?: string | null
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
          zoho_contact_id: string | null
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
          zoho_contact_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          profile_id?: string | null
          address?: Json | null
          source?: 'web' | 'humble_house' | 'referral' | null
          email?: string | null
          full_name?: string | null
          zoho_contact_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          id: string
          builder_id: string
          customer_id: string | null
          zoho_lead_id: string | null
          source: 'zoho' | 'site' | 'design_centre' | 'referral'
          stage: 'inquiry' | 'warm' | 'quoting' | 'quoted' | 'revising' | 'contract_sent' | 'won' | 'lost'
          owner_profile_id: string | null
          platform_interest_id: string | null
          notes: string | null
          lost_reason: string | null
          message: string | null
          phone: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          builder_id: string
          customer_id?: string | null
          zoho_lead_id?: string | null
          source?: 'zoho' | 'site' | 'design_centre' | 'referral'
          stage?: 'inquiry' | 'warm' | 'quoting' | 'quoted' | 'revising' | 'contract_sent' | 'won' | 'lost'
          owner_profile_id?: string | null
          platform_interest_id?: string | null
          notes?: string | null
          lost_reason?: string | null
          message?: string | null
          phone?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          builder_id?: string
          customer_id?: string | null
          zoho_lead_id?: string | null
          source?: 'zoho' | 'site' | 'design_centre' | 'referral'
          stage?: 'inquiry' | 'warm' | 'quoting' | 'quoted' | 'revising' | 'contract_sent' | 'won' | 'lost'
          owner_profile_id?: string | null
          platform_interest_id?: string | null
          notes?: string | null
          lost_reason?: string | null
          message?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      quotes: {
        Row: {
          id: string
          lead_id: string
          builder_id: string
          version: number
          platform_id: string
          tier_id: string
          price_cents: number
          status: 'draft' | 'sent' | 'approved' | 'superseded'
          pdf_url: string | null
          sent_at: string | null
          approved_at: string | null
          notes: string | null
          token: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          lead_id: string
          builder_id: string
          version: number
          platform_id: string
          tier_id: string
          price_cents?: number
          status?: 'draft' | 'sent' | 'approved' | 'superseded'
          pdf_url?: string | null
          sent_at?: string | null
          approved_at?: string | null
          notes?: string | null
          token?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          lead_id?: string
          builder_id?: string
          version?: number
          platform_id?: string
          tier_id?: string
          price_cents?: number
          status?: 'draft' | 'sent' | 'approved' | 'superseded'
          pdf_url?: string | null
          sent_at?: string | null
          approved_at?: string | null
          notes?: string | null
          token?: string
          updated_at?: string
        }
        Relationships: []
      }
      quote_options: {
        Row: {
          id: string
          quote_id: string
          option_id: string
          price_cents_at_selection: number
          created_at: string
        }
        Insert: {
          id?: string
          quote_id: string
          option_id: string
          price_cents_at_selection: number
          created_at?: string
        }
        Update: {
          quote_id?: string
          option_id?: string
          price_cents_at_selection?: number
        }
        Relationships: []
      }
      quote_events: {
        Row: {
          id: string
          quote_id: string
          kind: 'created' | 'sent' | 'viewed' | 'revised' | 'approved'
          by_profile_id: string | null
          note: string | null
          created_at: string
        }
        Insert: {
          id?: string
          quote_id: string
          kind: 'created' | 'sent' | 'viewed' | 'revised' | 'approved'
          by_profile_id?: string | null
          note?: string | null
          created_at?: string
        }
        Update: {
          quote_id?: string
          kind?: 'created' | 'sent' | 'viewed' | 'revised' | 'approved'
          by_profile_id?: string | null
          note?: string | null
        }
        Relationships: []
      }
      vehicles: {
        Row: {
          id: string
          customer_id: string
          platform_id: string
          vin: string | null
          year: number | null
          mileage: number | null
          colour_original: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          customer_id: string
          platform_id: string
          vin?: string | null
          year?: number | null
          mileage?: number | null
          colour_original?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          customer_id?: string
          platform_id?: string
          vin?: string | null
          year?: number | null
          mileage?: number | null
          colour_original?: string | null
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      builds: {
        Row: {
          id: string
          builder_id: string
          customer_id: string
          vehicle_id: string | null
          platform_id: string
          tier_id: string
          stage: string
          slot_year: number | null
          slot_number: number | null
          price_cents: number | null
          notes: string | null
          payment_status: 'unpaid' | 'pending' | 'paid' | 'failed'
          quote_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          builder_id: string
          customer_id: string
          vehicle_id?: string | null
          platform_id: string
          tier_id: string
          stage?: string
          slot_year?: number | null
          slot_number?: number | null
          price_cents?: number | null
          notes?: string | null
          payment_status?: 'unpaid' | 'pending' | 'paid' | 'failed'
          quote_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          builder_id?: string
          customer_id?: string
          vehicle_id?: string | null
          platform_id?: string
          tier_id?: string
          stage?: string
          slot_year?: number | null
          slot_number?: number | null
          price_cents?: number | null
          notes?: string | null
          payment_status?: 'unpaid' | 'pending' | 'paid' | 'failed'
          quote_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      build_options: {
        Row: {
          id: string
          build_id: string
          option_id: string
          price_cents_at_selection: number
          created_at: string
        }
        Insert: {
          id?: string
          build_id: string
          option_id: string
          price_cents_at_selection: number
          created_at?: string
        }
        Update: {
          build_id?: string
          option_id?: string
          price_cents_at_selection?: number
        }
        Relationships: []
      }
      build_stage_events: {
        Row: {
          id: string
          build_id: string
          from_stage: string | null
          to_stage: string
          by_profile_id: string | null
          note: string | null
          created_at: string
        }
        Insert: {
          id?: string
          build_id: string
          from_stage?: string | null
          to_stage: string
          by_profile_id?: string | null
          note?: string | null
          created_at?: string
        }
        Update: {
          build_id?: string
          from_stage?: string | null
          to_stage?: string
          by_profile_id?: string | null
          note?: string | null
        }
        Relationships: []
      }
      media: {
        Row: {
          id: string
          build_id: string | null
          option_id: string | null
          storage_path: string
          kind: 'swatch' | 'hero' | 'build_photo' | 'document'
          caption: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          build_id?: string | null
          option_id?: string | null
          storage_path: string
          kind: 'swatch' | 'hero' | 'build_photo' | 'document'
          caption?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          build_id?: string | null
          option_id?: string | null
          storage_path?: string
          kind?: 'swatch' | 'hero' | 'build_photo' | 'document'
          caption?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      zoho_sync_log: {
        Row: {
          id: string
          direction: 'inbound' | 'outbound'
          object: string
          object_id: string | null
          payload: Json
          status: 'success' | 'error' | 'pending'
          error: string | null
          created_at: string
        }
        Insert: {
          id?: string
          direction: 'inbound' | 'outbound'
          object: string
          object_id?: string | null
          payload?: Json
          status: 'success' | 'error' | 'pending'
          error?: string | null
          created_at?: string
        }
        Update: {
          direction?: 'inbound' | 'outbound'
          object?: string
          object_id?: string | null
          payload?: Json
          status?: 'success' | 'error' | 'pending'
          error?: string | null
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
          active: boolean
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
          active?: boolean
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
          active?: boolean
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
export type Customer = Database['public']['Tables']['customers']['Row']
export type Lead = Database['public']['Tables']['leads']['Row']
export type Quote = Database['public']['Tables']['quotes']['Row']
export type QuoteOption = Database['public']['Tables']['quote_options']['Row']
export type QuoteEvent = Database['public']['Tables']['quote_events']['Row']
export type ZohoSyncLog = Database['public']['Tables']['zoho_sync_log']['Row']

export const LEAD_STAGES = [
  'inquiry', 'warm', 'quoting', 'quoted', 'revising',
  'contract_sent', 'won', 'lost',
] as const
export type LeadStage = typeof LEAD_STAGES[number]
