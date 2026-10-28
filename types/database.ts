
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "admin_profiles": {
                  Row: {
                    "created_at": string,"created_by": string | null,"display_name": string | null,"role": Database["public"]['Enums']["admin_role"],"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"display_name"?: string | null,"role": Database["public"]['Enums']["admin_role"],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"display_name"?: string | null,"role"?: Database["public"]['Enums']["admin_role"],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"audit_log": {
                  Row: {
                    "action": string,"actor": string | null,"actor_role": string,"after": Json | null,"at": string,"before": Json | null,"entity": string,"entity_id": string | null,"id": number
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor"?: string | null,"actor_role": string,"after"?: Json | null,"at"?: string,"before"?: Json | null,"entity": string,"entity_id"?: string | null,"id"?: never
                  }
                  Update: {
                    "action"?: string,"actor"?: string | null,"actor_role"?: string,"after"?: Json | null,"at"?: string,"before"?: Json | null,"entity"?: string,"entity_id"?: string | null,"id"?: never
                  }
                  Relationships: [
                    
                  ]
                },"bundle_items": {
                  Row: {
                    "bundle_id": string,"product_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bundle_id": string,"product_id": string
                  }
                  Update: {
                    "bundle_id"?: string,"product_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "bundle_items_bundle_id_fkey"
      columns: ["bundle_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bundle_items_bundle_id_fkey"
      columns: ["bundle_id"]
isOneToOne: false
      referencedRelation: "public_catalog"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bundle_items_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bundle_items_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_catalog"
      referencedColumns: ["id"]
    }
                  ]
                },"categories": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"slug": string,"sort": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"slug": string,"sort"?: number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"slug"?: string,"sort"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"coupons": {
                  Row: {
                    "active": boolean,"amount_off_minor": number | null,"code": string,"created_at": string,"currency": string | null,"ends_at": string | null,"id": string,"max_redemptions": number | null,"per_email_limit": number | null,"percent_off": number | null,"starts_at": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"amount_off_minor"?: number | null,"code": string,"created_at"?: string,"currency"?: string | null,"ends_at"?: string | null,"id"?: string,"max_redemptions"?: number | null,"per_email_limit"?: number | null,"percent_off"?: number | null,"starts_at"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "active"?: boolean,"amount_off_minor"?: number | null,"code"?: string,"created_at"?: string,"currency"?: string | null,"ends_at"?: string | null,"id"?: string,"max_redemptions"?: number | null,"per_email_limit"?: number | null,"percent_off"?: number | null,"starts_at"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"delivery_tokens": {
                  Row: {
                    "created_at": string,"download_count": number,"expires_at": string,"fulfilment_id": string,"id": string,"last_used_at": string | null,"max_downloads": number,"revoked_at": string | null,"revoked_reason": string | null,"token_hash": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"download_count"?: number,"expires_at": string,"fulfilment_id": string,"id"?: string,"last_used_at"?: string | null,"max_downloads": number,"revoked_at"?: string | null,"revoked_reason"?: string | null,"token_hash": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"download_count"?: number,"expires_at"?: string,"fulfilment_id"?: string,"id"?: string,"last_used_at"?: string | null,"max_downloads"?: number,"revoked_at"?: string | null,"revoked_reason"?: string | null,"token_hash"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "delivery_tokens_fulfilment_id_fkey"
      columns: ["fulfilment_id"]
isOneToOne: false
      referencedRelation: "fulfilments"
      referencedColumns: ["id"]
    }
                  ]
                },"email_events": {
                  Row: {
                    "attempts": number,"created_at": string,"dedupe_key": string,"id": string,"last_error": string | null,"next_attempt_at": string,"order_id": string | null,"provider_message_id": string | null,"sent_at": string | null,"status": Database["public"]['Enums']["email_status"],"template": string,"to_email": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"created_at"?: string,"dedupe_key"?: string,"id"?: string,"last_error"?: string | null,"next_attempt_at"?: string,"order_id"?: string | null,"provider_message_id"?: string | null,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["email_status"],"template": string,"to_email": string,"updated_at"?: string
                  }
                  Update: {
                    "attempts"?: number,"created_at"?: string,"dedupe_key"?: string,"id"?: string,"last_error"?: string | null,"next_attempt_at"?: string,"order_id"?: string | null,"provider_message_id"?: string | null,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["email_status"],"template"?: string,"to_email"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "email_events_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    }
                  ]
                },"fulfilments": {
                  Row: {
                    "asset_id": string,"created_at": string,"delivered_at": string | null,"id": string,"kind": Database["public"]['Enums']["asset_kind"],"order_id": string,"order_item_id": string,"status": Database["public"]['Enums']["fulfilment_status"],"status_reason": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "asset_id": string,"created_at"?: string,"delivered_at"?: string | null,"id"?: string,"kind": Database["public"]['Enums']["asset_kind"],"order_id": string,"order_item_id": string,"status"?: Database["public"]['Enums']["fulfilment_status"],"status_reason"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "asset_id"?: string,"created_at"?: string,"delivered_at"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["asset_kind"],"order_id"?: string,"order_item_id"?: string,"status"?: Database["public"]['Enums']["fulfilment_status"],"status_reason"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "fulfilments_asset_id_fkey"
      columns: ["asset_id"]
isOneToOne: false
      referencedRelation: "product_assets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fulfilments_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fulfilments_order_item_id_fkey"
      columns: ["order_item_id"]
isOneToOne: false
      referencedRelation: "order_items"
      referencedColumns: ["id"]
    }
                  ]
                },"order_items": {
                  Row: {
                    "created_at": string,"currency": string,"id": string,"line_total_minor": number,"order_id": string,"product_id": string,"product_type": Database["public"]['Enums']["product_type"],"quantity": number,"title": string,"unit_price_minor": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"currency": string,"id"?: string,"line_total_minor": number,"order_id": string,"product_id": string,"product_type": Database["public"]['Enums']["product_type"],"quantity"?: number,"title": string,"unit_price_minor": number
                  }
                  Update: {
                    "created_at"?: string,"currency"?: string,"id"?: string,"line_total_minor"?: number,"order_id"?: string,"product_id"?: string,"product_type"?: Database["public"]['Enums']["product_type"],"quantity"?: number,"title"?: string,"unit_price_minor"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_items_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "order_items_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "order_items_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_catalog"
      referencedColumns: ["id"]
    }
                  ]
                },"orders": {
                  Row: {
                    "access_key_hash": string,"coupon_code": string | null,"coupon_id": string | null,"created_at": string,"currency": string,"discount_minor": number,"email": string,"expires_at": string,"id": string,"livemode": boolean,"marketing_opt_in": boolean,"paid_at": string | null,"provider": Database["public"]['Enums']["payment_provider"],"provider_txn_id": string | null,"reference": string,"refunded_minor": number,"status": Database["public"]['Enums']["order_status"],"subtotal_minor": number,"tax_minor": number,"terms_accepted_at": string,"total_minor": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "access_key_hash": string,"coupon_code"?: string | null,"coupon_id"?: string | null,"created_at"?: string,"currency": string,"discount_minor"?: number,"email": string,"expires_at"?: string,"id"?: string,"livemode"?: boolean,"marketing_opt_in"?: boolean,"paid_at"?: string | null,"provider": Database["public"]['Enums']["payment_provider"],"provider_txn_id"?: string | null,"reference"?: string,"refunded_minor"?: number,"status"?: Database["public"]['Enums']["order_status"],"subtotal_minor": number,"tax_minor"?: number,"terms_accepted_at": string,"total_minor": number,"updated_at"?: string
                  }
                  Update: {
                    "access_key_hash"?: string,"coupon_code"?: string | null,"coupon_id"?: string | null,"created_at"?: string,"currency"?: string,"discount_minor"?: number,"email"?: string,"expires_at"?: string,"id"?: string,"livemode"?: boolean,"marketing_opt_in"?: boolean,"paid_at"?: string | null,"provider"?: Database["public"]['Enums']["payment_provider"],"provider_txn_id"?: string | null,"reference"?: string,"refunded_minor"?: number,"status"?: Database["public"]['Enums']["order_status"],"subtotal_minor"?: number,"tax_minor"?: number,"terms_accepted_at"?: string,"total_minor"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "orders_coupon_id_fkey"
      columns: ["coupon_id"]
isOneToOne: false
      referencedRelation: "coupons"
      referencedColumns: ["id"]
    }
                  ]
                },"payment_events": {
                  Row: {
                    "attempts": number,"error": string | null,"id": string,"order_id": string | null,"payload": NonNullable<Json>,"processed_at": string | null,"provider": Database["public"]['Enums']["payment_provider"],"provider_event_id": string,"received_at": string,"status": Database["public"]['Enums']["event_status"],"type": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"error"?: string | null,"id"?: string,"order_id"?: string | null,"payload": NonNullable<Json>,"processed_at"?: string | null,"provider": Database["public"]['Enums']["payment_provider"],"provider_event_id": string,"received_at"?: string,"status"?: Database["public"]['Enums']["event_status"],"type": string,"updated_at"?: string
                  }
                  Update: {
                    "attempts"?: number,"error"?: string | null,"id"?: string,"order_id"?: string | null,"payload"?: NonNullable<Json>,"processed_at"?: string | null,"provider"?: Database["public"]['Enums']["payment_provider"],"provider_event_id"?: string,"received_at"?: string,"status"?: Database["public"]['Enums']["event_status"],"type"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_events_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    }
                  ]
                },"product_assets": {
                  Row: {
                    "access_mode": Database["public"]['Enums']["access_mode"],"active": boolean,"created_at": string,"external_url": string | null,"id": string,"instructions": string | null,"kind": Database["public"]['Enums']["asset_kind"],"label": string,"manual_eta_text": string | null,"product_id": string,"sort": number,"storage_path": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "access_mode"?: Database["public"]['Enums']["access_mode"],"active"?: boolean,"created_at"?: string,"external_url"?: string | null,"id"?: string,"instructions"?: string | null,"kind": Database["public"]['Enums']["asset_kind"],"label": string,"manual_eta_text"?: string | null,"product_id": string,"sort"?: number,"storage_path"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "access_mode"?: Database["public"]['Enums']["access_mode"],"active"?: boolean,"created_at"?: string,"external_url"?: string | null,"id"?: string,"instructions"?: string | null,"kind"?: Database["public"]['Enums']["asset_kind"],"label"?: string,"manual_eta_text"?: string | null,"product_id"?: string,"sort"?: number,"storage_path"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_assets_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_assets_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_catalog"
      referencedColumns: ["id"]
    }
                  ]
                },"product_categories": {
                  Row: {
                    "category_id": string,"product_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category_id": string,"product_id": string
                  }
                  Update: {
                    "category_id"?: string,"product_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_categories_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_categories_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_categories_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_catalog"
      referencedColumns: ["id"]
    }
                  ]
                },"products": {
                  Row: {
                    "allow_quantity": boolean,"archived_at": string | null,"compare_at_minor": number | null,"created_at": string,"currency": string,"description": (string)[],"display": NonNullable<Json>,"id": string,"images": NonNullable<Json>,"included": (string)[],"info": NonNullable<Json>,"price_minor": number,"published_at": string | null,"slug": string,"sort": number,"status": Database["public"]['Enums']["product_status"],"subtitle": string | null,"summary": string,"title": string,"type": Database["public"]['Enums']["product_type"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "allow_quantity"?: boolean,"archived_at"?: string | null,"compare_at_minor"?: number | null,"created_at"?: string,"currency": string,"description"?: (string)[],"display"?: NonNullable<Json>,"id"?: string,"images"?: NonNullable<Json>,"included"?: (string)[],"info"?: NonNullable<Json>,"price_minor": number,"published_at"?: string | null,"slug": string,"sort"?: number,"status"?: Database["public"]['Enums']["product_status"],"subtitle"?: string | null,"summary"?: string,"title": string,"type": Database["public"]['Enums']["product_type"],"updated_at"?: string
                  }
                  Update: {
                    "allow_quantity"?: boolean,"archived_at"?: string | null,"compare_at_minor"?: number | null,"created_at"?: string,"currency"?: string,"description"?: (string)[],"display"?: NonNullable<Json>,"id"?: string,"images"?: NonNullable<Json>,"included"?: (string)[],"info"?: NonNullable<Json>,"price_minor"?: number,"published_at"?: string | null,"slug"?: string,"sort"?: number,"status"?: Database["public"]['Enums']["product_status"],"subtitle"?: string | null,"summary"?: string,"title"?: string,"type"?: Database["public"]['Enums']["product_type"],"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            "public_catalog": {
                  Row: {
                    "allow_quantity": boolean | null,"bundle_contents": (unknown)[] | null,"categories": (string)[] | null,"compare_at_minor": number | null,"currency": string | null,"description": (string)[] | null,"display": Json | null,"id": string | null,"images": Json | null,"included": (string)[] | null,"info": Json | null,"price_minor": number | null,"published_at": string | null,"slug": string | null,"sort": number | null,"subtitle": string | null,"summary": string | null,"title": string | null,"type": Database["public"]['Enums']["product_type"] | null
                  }
                  ComputedFields: never
                  Insert: {
                           "allow_quantity"?: boolean | null,"bundle_contents"?: never,"categories"?: never,"compare_at_minor"?: number | null,"currency"?: string | null,"description"?: (string)[] | null,"display"?: Json | null,"id"?: string | null,"images"?: Json | null,"included"?: (string)[] | null,"info"?: Json | null,"price_minor"?: number | null,"published_at"?: string | null,"slug"?: string | null,"sort"?: number | null,"subtitle"?: string | null,"summary"?: string | null,"title"?: string | null,"type"?: Database["public"]['Enums']["product_type"] | null
                         }
                        Update: {
                           "allow_quantity"?: boolean | null,"bundle_contents"?: never,"categories"?: never,"compare_at_minor"?: number | null,"currency"?: string | null,"description"?: (string)[] | null,"display"?: Json | null,"id"?: string | null,"images"?: Json | null,"included"?: (string)[] | null,"info"?: Json | null,"price_minor"?: number | null,"published_at"?: string | null,"slug"?: string | null,"sort"?: number | null,"subtitle"?: string | null,"summary"?: string | null,"title"?: string | null,"type"?: Database["public"]['Enums']["product_type"] | null
                         }
                        Relationships: [
                    
                  ]
                }
          }
          Functions: {
            [_ in never]: never
          }
          Enums: {
            "access_mode": "instant"|"manual","admin_role": "owner"|"admin"|"support","asset_kind": "file"|"external","email_status": "queued"|"sent"|"failed","event_status": "received"|"processed"|"ignored"|"failed","fulfilment_status": "queued"|"delivered"|"action_required"|"revoked"|"failed","order_status": "pending"|"paid"|"failed"|"expired"|"refunded"|"partially_refunded"|"disputed","payment_provider": "paystack"|"stripe","product_status": "draft"|"published"|"archived","product_type": "course"|"book"|"guide"|"template"|"bundle"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "access_mode": ["instant", "manual"],"admin_role": ["owner", "admin", "support"],"asset_kind": ["file", "external"],"email_status": ["queued", "sent", "failed"],"event_status": ["received", "processed", "ignored", "failed"],"fulfilment_status": ["queued", "delivered", "action_required", "revoked", "failed"],"order_status": ["pending", "paid", "failed", "expired", "refunded", "partially_refunded", "disputed"],"payment_provider": ["paystack", "stripe"],"product_status": ["draft", "published", "archived"],"product_type": ["course", "book", "guide", "template", "bundle"]
          }
        }
} as const
