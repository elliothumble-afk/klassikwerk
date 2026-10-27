-- Cleanup: 14 CTC platforms left over from early sync runs plus two
-- hand-made L663 placeholders from before the storefront sync landed.
-- All of them have zero catalog_option_platforms rows pointing at
-- them (the live sync re-linked everything under the newer slugs on
-- 2026-10-23) so deleting them is safe. Options are left as-is.
--
-- After this migration CTC has exactly 13 platforms, the same set the
-- current sync maintains: five Land Rover Defenders, three Jeep
-- Wranglers, three Toyota Land Cruisers, two Mercedes-Benz G-Wagons,
-- and one Ineos Grenadier.

DELETE FROM catalog_platforms
 WHERE builder_id = '20000000-0000-0000-0000-000000000004'
   AND slug IN (
     -- stale shortened slugs from early sync runs
     'defender-90-1991-2016',
     'defender-90-2020-present',
     'defender-110-1991-2016',
     'defender-110-2020-present',
     'defender-130-2020-present',
     'grenadier-2023-present',
     'mercedes-g-wagon-2018-present',
     'mercedes-g-wagon-g350-400-2018-present',
     'wrangler-jl-2-door-2018-present',
     'wrangler-jl-4-door-2018-present',
     'toyota-land-cruiser-70-2-door',
     -- manual placeholders from before the sync was wired
     'grenadier',
     'defender-l663-90',
     'defender-l663-110'
   );
