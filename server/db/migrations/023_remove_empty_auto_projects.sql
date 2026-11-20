-- SmartFlow Migration 023: remove the empty SI-sellers that sign-in used to create for everyone.
-- Until 20 Nov. every first sign-in (clients too) got an SI-seller "Проект: Имя" with a link
-- "<username>-sales" / "expert-1234-sales". Experts saw two SI-sellers instead of one, clients could
-- open an unconfigured SI, and two people without a @username sharing the last 4 digits of their
-- Telegram id broke on the first sign-in. Sign-in no longer creates it (auth-service.js).
--
-- Only rows that nobody ever touched are removed: never edited (updated_at = created_at), nothing
-- filled in, and nothing anywhere points to it — no clients, messages, materials, links, meetings,
-- receipts, reviews, broadcasts, members. Anything a person used stays as it is.
-- Works on SQLite and PostgreSQL.

DELETE FROM projects
WHERE name LIKE 'Проект: %'
  AND slug LIKE '%-sales'
  AND template_id IS NULL
  AND COALESCE(is_demo, 0) = 0
  AND updated_at = created_at
  AND COALESCE(offer, '') = ''
  AND COALESCE(description, '') = ''
  AND COALESCE(price_label, '') = ''
  AND payment_url IS NULL
  AND access_url IS NULL
  AND photo_media_id IS NULL
  AND role_title IS NULL
  AND COALESCE(is_listed, 0) = 0
  AND NOT EXISTS (SELECT 1 FROM clients x WHERE x.project_id = projects.id)
  AND NOT EXISTS (SELECT 1 FROM conversations x WHERE x.project_id = projects.id)
  AND NOT EXISTS (SELECT 1 FROM direct_inquiries x WHERE x.project_id = projects.id)
  AND NOT EXISTS (SELECT 1 FROM consultant_materials x WHERE x.project_id = projects.id)
  AND NOT EXISTS (SELECT 1 FROM client_events x WHERE x.project_id = projects.id)
  AND NOT EXISTS (SELECT 1 FROM payment_receipts x WHERE x.project_id = projects.id)
  AND NOT EXISTS (SELECT 1 FROM voice_messages x WHERE x.project_id = projects.id)
  AND NOT EXISTS (SELECT 1 FROM meetings x WHERE x.project_id = projects.id)
  AND NOT EXISTS (SELECT 1 FROM reviews x WHERE x.project_id = projects.id)
  AND NOT EXISTS (SELECT 1 FROM broadcasts x WHERE x.project_id = projects.id)
  AND NOT EXISTS (SELECT 1 FROM tracked_links x WHERE x.project_id = projects.id)
  AND NOT EXISTS (SELECT 1 FROM project_members x WHERE x.project_id = projects.id);
