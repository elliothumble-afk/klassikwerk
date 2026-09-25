export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          user_id: string
          role: 'customer' | 'ops' | 'partner'
          full_name: string | null
          phone: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          role?: 'customer' | 'ops' | 'partner'
          full_name?: string | null
          phone?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          user_id?: string
          role?: 'customer' | 'ops' | 'partner'
          full_name?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          id: string
          profile_id: string
          address: Json | null
          source: 'web' | 'humble_house' | 'referral' | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          address?: Json | null
          source?: 'web' | 'humble_house' | 'referral' | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          profile_id?: string
          address?: Json | null
          source?: 'web' | 'humble_house' | 'referral' | null
          updated_at?: string
        }
        Relationships: []
      }
      catalog_platforms: {
        Row: {
          id: string
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
    }
    Views: Record<string, never>
    Functions: {
      auth_is_ops: {
        Args: Record<PropertyKey, never>
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
