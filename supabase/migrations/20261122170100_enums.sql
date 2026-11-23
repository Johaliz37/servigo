create type public.member_role as enum ('owner', 'admin', 'staff');
create type public.company_status as enum ('active', 'suspended');
create type public.catalog_kind as enum ('service', 'product');
create type public.discount_type as enum ('percent', 'fixed');
-- Información adicional: texto libre → text/textarea; lista de ítems → select/multiselect;
-- check → checkbox; lista de opciones → radio.
create type public.field_type as enum ('text', 'textarea', 'select', 'multiselect', 'radio', 'checkbox', 'number', 'date');
create type public.availability_kind as enum ('open', 'closed');
create type public.booking_status as enum ('pending', 'confirmed', 'completed', 'cancelled', 'no_show');
create type public.social_network as enum (
  'facebook', 'instagram', 'tiktok', 'x', 'youtube', 'linkedin', 'whatsapp', 'website', 'email', 'phone', 'other'
);
