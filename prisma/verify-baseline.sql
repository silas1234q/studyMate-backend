-- Run this BEFORE baselining the migration history.
--
-- `prisma migrate resolve --applied` only writes a row into _prisma_migrations;
-- it does not inspect or change the schema. So if any of these artifacts is
-- missing, marking that migration "applied" would skip a real change forever.
--
-- Every row must report present = true.

SELECT '20260527082233_first_migration' AS migration,
       to_regclass('public."User"') IS NOT NULL AS present
UNION ALL
SELECT '20260527184458_added_user_preference',
       to_regclass('public."UserPreferences"') IS NOT NULL
UNION ALL
SELECT '20260604161849_init_courses_chat',
       to_regclass('public."Course"') IS NOT NULL
   AND to_regclass('public."ChatMessage"') IS NOT NULL
UNION ALL
SELECT '20260624124458_add_subscription_system',
       to_regclass('public."Subscription"') IS NOT NULL
   AND to_regclass('public."UsageTracker"') IS NOT NULL
UNION ALL
SELECT '20260624212712_add_topic_overview',
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'Topic' AND column_name = 'overview')
UNION ALL
SELECT '20260822120000_add_tutorial_completed_at',
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'UserPreferences' AND column_name = 'tutorialCompletedAt')
UNION ALL
SELECT '20260822140000_add_course_materials',
       to_regclass('public."CourseMaterial"') IS NOT NULL
UNION ALL
SELECT '20260822150000_file_attachments',
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'ChatMessage' AND column_name = 'attachmentUrl')
   AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'QuickChatMessage' AND column_name = 'attachmentUrl')
UNION ALL
-- This one SHOULD be false: it is the migration you are about to apply.
SELECT '20260823150000_multi_attachments (expected false)',
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'QuickChatMessage' AND column_name = 'attachmentUrls');
