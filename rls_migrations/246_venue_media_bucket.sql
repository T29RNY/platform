-- 246: Supabase Storage bucket `venue-media` (Reception Display Part A3).
-- Holds operator-uploaded sponsor creative for the reception display's tall
-- promo panel. No new RPC: the venue app uploads with the Supabase JS storage
-- client under the operator's authenticated session, then saves the public URL
-- through venue_update_display_config.sponsor_image_url (mig 245).
--
-- Access model:
--   READ  — bucket is PUBLIC: objects are served via the /object/public/ URL
--           the display app embeds. No SELECT policy needed for that path.
--   WRITE — authenticated venue staff only, scoped to their own venue: the
--           object path must start with the caller's venue_id folder
--           (`<venue_id>/...`), checked against an active venue_admins
--           membership. Legacy shared-token venues have no authenticated
--           staff user, so they cannot upload until they have logins (venue
--           staff logins epic) — known limitation, recorded in the scope doc.
--   Limits — 5 MB per object, image mime types only.
--
-- Consumers (hard-rule #14): apps/venue DisplaySettings image upload (Part C);
-- apps/display TallPromo renders the resulting sponsor_image_url (Part B).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('venue-media', 'venue-media', true, 5242880,
        ARRAY['image/png','image/jpeg','image/webp','image/gif','image/svg+xml'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "venue_media_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'venue-media'
    AND EXISTS (
      SELECT 1 FROM public.venue_admins va
      WHERE va.user_id = auth.uid()
        AND va.status = 'active'
        AND va.revoked_at IS NULL
        AND va.venue_id = (storage.foldername(name))[1]
    )
  );

CREATE POLICY "venue_media_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'venue-media'
    AND EXISTS (
      SELECT 1 FROM public.venue_admins va
      WHERE va.user_id = auth.uid()
        AND va.status = 'active'
        AND va.revoked_at IS NULL
        AND va.venue_id = (storage.foldername(name))[1]
    )
  )
  WITH CHECK (
    bucket_id = 'venue-media'
    AND EXISTS (
      SELECT 1 FROM public.venue_admins va
      WHERE va.user_id = auth.uid()
        AND va.status = 'active'
        AND va.revoked_at IS NULL
        AND va.venue_id = (storage.foldername(name))[1]
    )
  );

CREATE POLICY "venue_media_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'venue-media'
    AND EXISTS (
      SELECT 1 FROM public.venue_admins va
      WHERE va.user_id = auth.uid()
        AND va.status = 'active'
        AND va.revoked_at IS NULL
        AND va.venue_id = (storage.foldername(name))[1]
    )
  );
