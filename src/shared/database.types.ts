export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: { Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json }; Returns: Json };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      about_sections: {
        Row: {
          body: string;
          branch_id: string | null;
          company_id: string;
          created_at: string;
          id: string;
          image_path: string | null;
          is_visible: boolean;
          sort_order: number;
          title: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          body?: string;
          branch_id?: string | null;
          company_id: string;
          created_at?: string;
          id?: string;
          image_path?: string | null;
          is_visible?: boolean;
          sort_order?: number;
          title?: string;
          updated_at?: string;
        };
        Update: {
          body?: string;
          branch_id?: string | null;
          company_id?: string;
          created_at?: string;
          id?: string;
          image_path?: string | null;
          is_visible?: boolean;
          sort_order?: number;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'about_sections_branch_id_fkey';
            columns: ['branch_id'];
            isOneToOne: false;
            referencedRelation: 'branches';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'about_sections_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
        ];
      };
      availability_events: {
        Row: {
          all_day: boolean;
          branch_id: string | null;
          capacity_override: number | null;
          color: string | null;
          company_id: string;
          created_at: string;
          ends_at: string;
          exdates: string[];
          id: string;
          kind: Database['public']['Enums']['availability_kind'];
          notes: string | null;
          recurrence_original_start: string | null;
          recurrence_parent_id: string | null;
          rrule: string | null;
          service_ids: string[] | null;
          starts_at: string;
          timezone: string;
          title: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          all_day?: boolean;
          branch_id?: string | null;
          capacity_override?: number | null;
          color?: string | null;
          company_id: string;
          created_at?: string;
          ends_at: string;
          exdates?: string[];
          id?: string;
          kind: Database['public']['Enums']['availability_kind'];
          notes?: string | null;
          recurrence_original_start?: string | null;
          recurrence_parent_id?: string | null;
          rrule?: string | null;
          service_ids?: string[] | null;
          starts_at: string;
          timezone?: string;
          title?: string;
          updated_at?: string;
        };
        Update: {
          all_day?: boolean;
          branch_id?: string | null;
          capacity_override?: number | null;
          color?: string | null;
          company_id?: string;
          created_at?: string;
          ends_at?: string;
          exdates?: string[];
          id?: string;
          kind?: Database['public']['Enums']['availability_kind'];
          notes?: string | null;
          recurrence_original_start?: string | null;
          recurrence_parent_id?: string | null;
          rrule?: string | null;
          service_ids?: string[] | null;
          starts_at?: string;
          timezone?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'availability_events_branch_id_fkey';
            columns: ['branch_id'];
            isOneToOne: false;
            referencedRelation: 'branches';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'availability_events_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'availability_events_recurrence_parent_id_fkey';
            columns: ['recurrence_parent_id'];
            isOneToOne: false;
            referencedRelation: 'availability_events';
            referencedColumns: ['id'];
          },
        ];
      };
      booking_answers: {
        Row: {
          booking_id: string;
          company_id: string;
          created_at: string;
          field_id: string | null;
          id: string;
          label: string;
          type: Database['public']['Enums']['field_type'];
          updated_at: string;
          value: NonNullable<Json>;
        };
        ComputedFields: never;
        Insert: {
          booking_id: string;
          company_id: string;
          created_at?: string;
          field_id?: string | null;
          id?: string;
          label: string;
          type: Database['public']['Enums']['field_type'];
          updated_at?: string;
          value: NonNullable<Json>;
        };
        Update: {
          booking_id?: string;
          company_id?: string;
          created_at?: string;
          field_id?: string | null;
          id?: string;
          label?: string;
          type?: Database['public']['Enums']['field_type'];
          updated_at?: string;
          value?: NonNullable<Json>;
        };
        Relationships: [
          {
            foreignKeyName: 'booking_answers_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'bookings';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'booking_answers_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'booking_answers_field_id_fkey';
            columns: ['field_id'];
            isOneToOne: false;
            referencedRelation: 'booking_fields';
            referencedColumns: ['id'];
          },
        ];
      };
      booking_events: {
        Row: {
          action: string;
          actor: string | null;
          booking_id: string;
          company_id: string;
          created_at: string;
          id: string;
          payload: NonNullable<Json>;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          actor?: string | null;
          booking_id: string;
          company_id: string;
          created_at?: string;
          id?: string;
          payload?: NonNullable<Json>;
        };
        Update: {
          action?: string;
          actor?: string | null;
          booking_id?: string;
          company_id?: string;
          created_at?: string;
          id?: string;
          payload?: NonNullable<Json>;
        };
        Relationships: [
          {
            foreignKeyName: 'booking_events_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'bookings';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'booking_events_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
        ];
      };
      booking_fields: {
        Row: {
          company_id: string;
          created_at: string;
          help_text: string | null;
          id: string;
          is_active: boolean;
          label: string;
          options: NonNullable<Json>;
          placeholder: string | null;
          required: boolean;
          service_id: string | null;
          sort_order: number;
          type: Database['public']['Enums']['field_type'];
          updated_at: string;
          validation: NonNullable<Json>;
        };
        ComputedFields: never;
        Insert: {
          company_id: string;
          created_at?: string;
          help_text?: string | null;
          id?: string;
          is_active?: boolean;
          label: string;
          options?: NonNullable<Json>;
          placeholder?: string | null;
          required?: boolean;
          service_id?: string | null;
          sort_order?: number;
          type: Database['public']['Enums']['field_type'];
          updated_at?: string;
          validation?: NonNullable<Json>;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          help_text?: string | null;
          id?: string;
          is_active?: boolean;
          label?: string;
          options?: NonNullable<Json>;
          placeholder?: string | null;
          required?: boolean;
          service_id?: string | null;
          sort_order?: number;
          type?: Database['public']['Enums']['field_type'];
          updated_at?: string;
          validation?: NonNullable<Json>;
        };
        Relationships: [
          {
            foreignKeyName: 'booking_fields_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'booking_fields_service_id_fkey';
            columns: ['service_id'];
            isOneToOne: false;
            referencedRelation: 'catalog_items';
            referencedColumns: ['id'];
          },
        ];
      };
      booking_items: {
        Row: {
          booking_id: string;
          company_id: string;
          created_at: string;
          discount: number;
          id: string;
          line_total: number;
          name: string;
          product_id: string | null;
          quantity: number;
          unit_price: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          booking_id: string;
          company_id: string;
          created_at?: string;
          discount?: number;
          id?: string;
          line_total: number;
          name: string;
          product_id?: string | null;
          quantity: number;
          unit_price: number;
          updated_at?: string;
        };
        Update: {
          booking_id?: string;
          company_id?: string;
          created_at?: string;
          discount?: number;
          id?: string;
          line_total?: number;
          name?: string;
          product_id?: string | null;
          quantity?: number;
          unit_price?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'booking_items_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'bookings';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'booking_items_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'booking_items_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'catalog_items';
            referencedColumns: ['id'];
          },
        ];
      };
      bookings: {
        Row: {
          block_ends_at: string;
          block_starts_at: string;
          branch_id: string;
          cancel_reason: string | null;
          cancelled_at: string | null;
          code: string;
          company_id: string;
          created_at: string;
          created_by: string | null;
          currency: string;
          customer_email: string | null;
          customer_id: string;
          customer_name: string;
          customer_notes: string | null;
          customer_phone: string;
          discount_total: number;
          ends_at: string;
          id: string;
          internal_notes: string | null;
          products_total: number;
          service_discount: number;
          service_id: string;
          service_name: string;
          service_price: number;
          source: string;
          starts_at: string;
          status: Database['public']['Enums']['booking_status'];
          total: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          block_ends_at: string;
          block_starts_at: string;
          branch_id: string;
          cancel_reason?: string | null;
          cancelled_at?: string | null;
          code?: string;
          company_id: string;
          created_at?: string;
          created_by?: string | null;
          currency: string;
          customer_email?: string | null;
          customer_id: string;
          customer_name: string;
          customer_notes?: string | null;
          customer_phone: string;
          discount_total?: number;
          ends_at: string;
          id?: string;
          internal_notes?: string | null;
          products_total?: number;
          service_discount?: number;
          service_id: string;
          service_name: string;
          service_price: number;
          source?: string;
          starts_at: string;
          status?: Database['public']['Enums']['booking_status'];
          total: number;
          updated_at?: string;
        };
        Update: {
          block_ends_at?: string;
          block_starts_at?: string;
          branch_id?: string;
          cancel_reason?: string | null;
          cancelled_at?: string | null;
          code?: string;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          customer_email?: string | null;
          customer_id?: string;
          customer_name?: string;
          customer_notes?: string | null;
          customer_phone?: string;
          discount_total?: number;
          ends_at?: string;
          id?: string;
          internal_notes?: string | null;
          products_total?: number;
          service_discount?: number;
          service_id?: string;
          service_name?: string;
          service_price?: number;
          source?: string;
          starts_at?: string;
          status?: Database['public']['Enums']['booking_status'];
          total?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'bookings_branch_id_fkey';
            columns: ['branch_id'];
            isOneToOne: false;
            referencedRelation: 'branches';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bookings_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bookings_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bookings_service_id_fkey';
            columns: ['service_id'];
            isOneToOne: false;
            referencedRelation: 'catalog_items';
            referencedColumns: ['id'];
          },
        ];
      };
      branch_catalog_items: {
        Row: {
          branch_id: string;
          company_id: string;
          created_at: string;
          is_active: boolean;
          item_id: string;
          price_override: number | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          branch_id: string;
          company_id: string;
          created_at?: string;
          is_active?: boolean;
          item_id: string;
          price_override?: number | null;
          updated_at?: string;
        };
        Update: {
          branch_id?: string;
          company_id?: string;
          created_at?: string;
          is_active?: boolean;
          item_id?: string;
          price_override?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'branch_catalog_items_branch_id_fkey';
            columns: ['branch_id'];
            isOneToOne: false;
            referencedRelation: 'branches';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'branch_catalog_items_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'branch_catalog_items_item_id_fkey';
            columns: ['item_id'];
            isOneToOne: false;
            referencedRelation: 'catalog_items';
            referencedColumns: ['id'];
          },
        ];
      };
      branches: {
        Row: {
          address: string | null;
          city: string | null;
          company_id: string;
          cover_image_path: string | null;
          created_at: string;
          email: string | null;
          header: NonNullable<Json>;
          id: string;
          is_active: boolean;
          lat: number | null;
          lng: number | null;
          maps_url: string | null;
          name: string;
          own_availability: boolean;
          own_catalog: boolean;
          phone: string | null;
          show_sponsors: boolean;
          slug: string;
          sort_order: number;
          timezone: string | null;
          updated_at: string;
          whatsapp: string | null;
        };
        ComputedFields: never;
        Insert: {
          address?: string | null;
          city?: string | null;
          company_id: string;
          cover_image_path?: string | null;
          created_at?: string;
          email?: string | null;
          header?: NonNullable<Json>;
          id?: string;
          is_active?: boolean;
          lat?: number | null;
          lng?: number | null;
          maps_url?: string | null;
          name: string;
          own_availability?: boolean;
          own_catalog?: boolean;
          phone?: string | null;
          show_sponsors?: boolean;
          slug: string;
          sort_order?: number;
          timezone?: string | null;
          updated_at?: string;
          whatsapp?: string | null;
        };
        Update: {
          address?: string | null;
          city?: string | null;
          company_id?: string;
          cover_image_path?: string | null;
          created_at?: string;
          email?: string | null;
          header?: NonNullable<Json>;
          id?: string;
          is_active?: boolean;
          lat?: number | null;
          lng?: number | null;
          maps_url?: string | null;
          name?: string;
          own_availability?: boolean;
          own_catalog?: boolean;
          phone?: string | null;
          show_sponsors?: boolean;
          slug?: string;
          sort_order?: number;
          timezone?: string | null;
          updated_at?: string;
          whatsapp?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'branches_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
        ];
      };
      catalog_item_details: {
        Row: {
          company_id: string;
          created_at: string;
          id: string;
          item_id: string;
          label: string;
          sort_order: number;
          updated_at: string;
          value: string | null;
        };
        ComputedFields: never;
        Insert: {
          company_id: string;
          created_at?: string;
          id?: string;
          item_id: string;
          label: string;
          sort_order?: number;
          updated_at?: string;
          value?: string | null;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          id?: string;
          item_id?: string;
          label?: string;
          sort_order?: number;
          updated_at?: string;
          value?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'catalog_item_details_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'catalog_item_details_item_id_fkey';
            columns: ['item_id'];
            isOneToOne: false;
            referencedRelation: 'catalog_items';
            referencedColumns: ['id'];
          },
        ];
      };
      catalog_item_photos: {
        Row: {
          alt: string | null;
          company_id: string;
          created_at: string;
          id: string;
          is_cover: boolean;
          item_id: string;
          path: string;
          sort_order: number;
          thumb_path: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          alt?: string | null;
          company_id: string;
          created_at?: string;
          id?: string;
          is_cover?: boolean;
          item_id: string;
          path: string;
          sort_order?: number;
          thumb_path?: string | null;
          updated_at?: string;
        };
        Update: {
          alt?: string | null;
          company_id?: string;
          created_at?: string;
          id?: string;
          is_cover?: boolean;
          item_id?: string;
          path?: string;
          sort_order?: number;
          thumb_path?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'catalog_item_photos_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'catalog_item_photos_item_id_fkey';
            columns: ['item_id'];
            isOneToOne: false;
            referencedRelation: 'catalog_items';
            referencedColumns: ['id'];
          },
        ];
      };
      catalog_items: {
        Row: {
          allow_in_booking: boolean;
          buffer_after_minutes: number;
          buffer_before_minutes: number;
          capacity: number;
          company_id: string;
          created_at: string;
          description: string | null;
          duration_minutes: number | null;
          id: string;
          is_active: boolean;
          is_featured: boolean;
          kind: Database['public']['Enums']['catalog_kind'];
          name: string;
          price: number;
          reference: string | null;
          short_description: string | null;
          sort_order: number;
          stock: number | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          allow_in_booking?: boolean;
          buffer_after_minutes?: number;
          buffer_before_minutes?: number;
          capacity?: number;
          company_id: string;
          created_at?: string;
          description?: string | null;
          duration_minutes?: number | null;
          id?: string;
          is_active?: boolean;
          is_featured?: boolean;
          kind: Database['public']['Enums']['catalog_kind'];
          name: string;
          price: number;
          reference?: string | null;
          short_description?: string | null;
          sort_order?: number;
          stock?: number | null;
          updated_at?: string;
        };
        Update: {
          allow_in_booking?: boolean;
          buffer_after_minutes?: number;
          buffer_before_minutes?: number;
          capacity?: number;
          company_id?: string;
          created_at?: string;
          description?: string | null;
          duration_minutes?: number | null;
          id?: string;
          is_active?: boolean;
          is_featured?: boolean;
          kind?: Database['public']['Enums']['catalog_kind'];
          name?: string;
          price?: number;
          reference?: string | null;
          short_description?: string | null;
          sort_order?: number;
          stock?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'catalog_items_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
        ];
      };
      companies: {
        Row: {
          booking_settings: NonNullable<Json>;
          contact_email: string | null;
          contact_phone: string | null;
          created_at: string;
          currency: string;
          favicon_path: string | null;
          footer: NonNullable<Json>;
          hero_image_path: string | null;
          id: string;
          legal_name: string | null;
          locale: string;
          logo_path: string | null;
          name: string;
          primary_color: string | null;
          secondary_color: string | null;
          seo: NonNullable<Json>;
          slug: string;
          status: Database['public']['Enums']['company_status'];
          tax_id: string | null;
          timezone: string;
          updated_at: string;
          whatsapp: string | null;
        };
        ComputedFields: never;
        Insert: {
          booking_settings?: NonNullable<Json>;
          contact_email?: string | null;
          contact_phone?: string | null;
          created_at?: string;
          currency?: string;
          favicon_path?: string | null;
          footer?: NonNullable<Json>;
          hero_image_path?: string | null;
          id?: string;
          legal_name?: string | null;
          locale?: string;
          logo_path?: string | null;
          name: string;
          primary_color?: string | null;
          secondary_color?: string | null;
          seo?: NonNullable<Json>;
          slug: string;
          status?: Database['public']['Enums']['company_status'];
          tax_id?: string | null;
          timezone?: string;
          updated_at?: string;
          whatsapp?: string | null;
        };
        Update: {
          booking_settings?: NonNullable<Json>;
          contact_email?: string | null;
          contact_phone?: string | null;
          created_at?: string;
          currency?: string;
          favicon_path?: string | null;
          footer?: NonNullable<Json>;
          hero_image_path?: string | null;
          id?: string;
          legal_name?: string | null;
          locale?: string;
          logo_path?: string | null;
          name?: string;
          primary_color?: string | null;
          secondary_color?: string | null;
          seo?: NonNullable<Json>;
          slug?: string;
          status?: Database['public']['Enums']['company_status'];
          tax_id?: string | null;
          timezone?: string;
          updated_at?: string;
          whatsapp?: string | null;
        };
        Relationships: [];
      };
      company_invitations: {
        Row: {
          accepted_at: string | null;
          branch_ids: string[] | null;
          company_id: string;
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          invited_by: string | null;
          role: Database['public']['Enums']['member_role'];
          token: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          accepted_at?: string | null;
          branch_ids?: string[] | null;
          company_id: string;
          created_at?: string;
          email: string;
          expires_at?: string;
          id?: string;
          invited_by?: string | null;
          role?: Database['public']['Enums']['member_role'];
          token?: string;
          updated_at?: string;
        };
        Update: {
          accepted_at?: string | null;
          branch_ids?: string[] | null;
          company_id?: string;
          created_at?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          invited_by?: string | null;
          role?: Database['public']['Enums']['member_role'];
          token?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'company_invitations_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
        ];
      };
      company_members: {
        Row: {
          branch_ids: string[] | null;
          company_id: string;
          created_at: string;
          id: string;
          role: Database['public']['Enums']['member_role'];
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          branch_ids?: string[] | null;
          company_id: string;
          created_at?: string;
          id?: string;
          role: Database['public']['Enums']['member_role'];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          branch_ids?: string[] | null;
          company_id?: string;
          created_at?: string;
          id?: string;
          role?: Database['public']['Enums']['member_role'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'company_members_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
        ];
      };
      customers: {
        Row: {
          company_id: string;
          created_at: string;
          email: string | null;
          id: string;
          name: string;
          notes: string | null;
          phone: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          company_id: string;
          created_at?: string;
          email?: string | null;
          id?: string;
          name: string;
          notes?: string | null;
          phone: string;
          updated_at?: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          email?: string | null;
          id?: string;
          name?: string;
          notes?: string | null;
          phone?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'customers_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
        ];
      };
      discounts: {
        Row: {
          branch_id: string | null;
          company_id: string;
          created_at: string;
          ends_at: string;
          id: string;
          is_active: boolean;
          item_id: string;
          label: string;
          starts_at: string | null;
          type: Database['public']['Enums']['discount_type'];
          updated_at: string;
          value: number;
        };
        ComputedFields: never;
        Insert: {
          branch_id?: string | null;
          company_id: string;
          created_at?: string;
          ends_at: string;
          id?: string;
          is_active?: boolean;
          item_id: string;
          label?: string;
          starts_at?: string | null;
          type: Database['public']['Enums']['discount_type'];
          updated_at?: string;
          value: number;
        };
        Update: {
          branch_id?: string | null;
          company_id?: string;
          created_at?: string;
          ends_at?: string;
          id?: string;
          is_active?: boolean;
          item_id?: string;
          label?: string;
          starts_at?: string | null;
          type?: Database['public']['Enums']['discount_type'];
          updated_at?: string;
          value?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'discounts_branch_id_fkey';
            columns: ['branch_id'];
            isOneToOne: false;
            referencedRelation: 'branches';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'discounts_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'discounts_item_id_fkey';
            columns: ['item_id'];
            isOneToOne: false;
            referencedRelation: 'catalog_items';
            referencedColumns: ['id'];
          },
        ];
      };
      platform_admins: {
        Row: {
          created_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      reserved_slugs: {
        Row: {
          created_at: string;
          reason: string;
          slug: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          reason?: string;
          slug: string;
        };
        Update: {
          created_at?: string;
          reason?: string;
          slug?: string;
        };
        Relationships: [];
      };
      service_products: {
        Row: {
          company_id: string;
          created_at: string;
          max_quantity: number;
          product_id: string;
          service_id: string;
          sort_order: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          company_id: string;
          created_at?: string;
          max_quantity?: number;
          product_id: string;
          service_id: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          max_quantity?: number;
          product_id?: string;
          service_id?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'service_products_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'service_products_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'catalog_items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'service_products_service_id_fkey';
            columns: ['service_id'];
            isOneToOne: false;
            referencedRelation: 'catalog_items';
            referencedColumns: ['id'];
          },
        ];
      };
      social_links: {
        Row: {
          branch_id: string | null;
          company_id: string;
          created_at: string;
          id: string;
          is_visible: boolean;
          label: string | null;
          network: Database['public']['Enums']['social_network'];
          sort_order: number;
          updated_at: string;
          url: string;
        };
        ComputedFields: never;
        Insert: {
          branch_id?: string | null;
          company_id: string;
          created_at?: string;
          id?: string;
          is_visible?: boolean;
          label?: string | null;
          network: Database['public']['Enums']['social_network'];
          sort_order?: number;
          updated_at?: string;
          url: string;
        };
        Update: {
          branch_id?: string | null;
          company_id?: string;
          created_at?: string;
          id?: string;
          is_visible?: boolean;
          label?: string | null;
          network?: Database['public']['Enums']['social_network'];
          sort_order?: number;
          updated_at?: string;
          url?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'social_links_branch_id_fkey';
            columns: ['branch_id'];
            isOneToOne: false;
            referencedRelation: 'branches';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'social_links_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
        ];
      };
      sponsors: {
        Row: {
          branch_id: string;
          company_id: string;
          created_at: string;
          description: string | null;
          id: string;
          image_path: string | null;
          is_visible: boolean;
          name: string;
          sort_order: number;
          updated_at: string;
          url: string | null;
        };
        ComputedFields: never;
        Insert: {
          branch_id: string;
          company_id: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          image_path?: string | null;
          is_visible?: boolean;
          name: string;
          sort_order?: number;
          updated_at?: string;
          url?: string | null;
        };
        Update: {
          branch_id?: string;
          company_id?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          image_path?: string | null;
          is_visible?: boolean;
          name?: string;
          sort_order?: number;
          updated_at?: string;
          url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'sponsors_branch_id_fkey';
            columns: ['branch_id'];
            isOneToOne: false;
            referencedRelation: 'branches';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'sponsors_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accept_invitation: { Args: { p_token: string }; Returns: Json };
      can_access_branch: { Args: { p_branch: string; p_company: string }; Returns: boolean };
      check_slug: { Args: { p_slug: string }; Returns: string };
      company_storage_usage: { Args: { p_company: string }; Returns: number };
      console_companies: {
        Args: Record<PropertyKey, never>;
        Returns: {
          bookings_this_month: number;
          branches_count: number;
          created_at: string;
          id: string;
          name: string;
          slug: string;
          status: Database['public']['Enums']['company_status'];
        }[];
      };
      create_company: {
        Args: { p_currency?: string; p_name: string; p_owner_email: string; p_slug: string; p_timezone?: string };
        Returns: Json;
      };
      generate_booking_code: { Args: Record<PropertyKey, never>; Returns: string };
      get_company_by_slug: { Args: { p_slug: string }; Returns: Json };
      get_invitation: { Args: { p_token: string }; Returns: Json };
      has_company_role: {
        Args: { p_company: string; p_roles?: Database['public']['Enums']['member_role'][] };
        Returns: boolean;
      };
      is_hex_color: { Args: { p_color: string }; Returns: boolean };
      is_platform_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_valid_timezone: { Args: { p_tz: string }; Returns: boolean };
      list_company_members: {
        Args: { p_company: string };
        Returns: {
          branch_ids: string[];
          created_at: string;
          email: string;
          id: string;
          last_sign_in_at: string;
          role: Database['public']['Enums']['member_role'];
          user_id: string;
        }[];
      };
      ping: { Args: Record<PropertyKey, never>; Returns: string };
      reorder_rows: { Args: { p_ids: string[]; p_table: string }; Returns: undefined };
      slug_status: { Args: { p_slug: string }; Returns: string };
      try_uuid: { Args: { p_value: string }; Returns: string };
    };
    Enums: {
      availability_kind: 'open' | 'closed';
      booking_status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
      catalog_kind: 'service' | 'product';
      company_status: 'active' | 'suspended';
      discount_type: 'percent' | 'fixed';
      field_type: 'text' | 'textarea' | 'select' | 'multiselect' | 'radio' | 'checkbox' | 'number' | 'date';
      member_role: 'owner' | 'admin' | 'staff';
      social_network:
        | 'facebook'
        | 'instagram'
        | 'tiktok'
        | 'x'
        | 'youtube'
        | 'linkedin'
        | 'whatsapp'
        | 'website'
        | 'email'
        | 'phone'
        | 'other';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    keyof (DefaultSchema['Tables'] & DefaultSchema['Views']) | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      availability_kind: ['open', 'closed'],
      booking_status: ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'],
      catalog_kind: ['service', 'product'],
      company_status: ['active', 'suspended'],
      discount_type: ['percent', 'fixed'],
      field_type: ['text', 'textarea', 'select', 'multiselect', 'radio', 'checkbox', 'number', 'date'],
      member_role: ['owner', 'admin', 'staff'],
      social_network: [
        'facebook',
        'instagram',
        'tiktok',
        'x',
        'youtube',
        'linkedin',
        'whatsapp',
        'website',
        'email',
        'phone',
        'other',
      ],
    },
  },
} as const;
