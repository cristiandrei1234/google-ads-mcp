# Google Ads MCP - Plan Complet Acoperire

## Ce este deja facut
- [x] Core tools: auth/account status, `run_gaql_query`, RBAC wrapper
- [x] Campaign/AdGroup/Keyword CRUD de baza
- [x] Negative keywords + negative keyword lists
- [x] Ads CRUD + `list_ads` + `update_ad_content`
- [x] Asset CRUD + asset links + asset groups
- [x] Campaign clone tools
- [x] Campaign drafts tools
- [x] Portfolio bidding + seasonality adjustments + data exclusions
- [x] Conversion actions + upload adjustments + conversion goals (customer/campaign)
- [x] Audience tools: user lists + custom audiences + combined audience targeting
- [x] Asset sets + asset set links + campaign asset set links + asset group signals
- [x] Experiments + reach planning + verticals tools registration
- [x] Build TypeScript trece (`npm run build`)

## TODO ramas in familiile deja implementate (paritate completa)
- [x] Campaigns: adaugat `get_campaign`
- [x] Campaign budgets: adaugat `list_campaign_budgets` + `get_campaign_budget`
- [x] Ad groups: adaugat `get_ad_group`
- [x] Keywords: adaugat `get_keyword`
- [x] Ads: adaugat `get_ad` (pe `ad_group_ad`/`ad.id`)
- [x] Assets: adaugat `get_asset`
- [x] Asset groups: adaugat `get_asset_group`
- [x] Negative keywords (campaign/ad_group): adaugat `list_*_negative_keywords` + `get_*_negative_keyword`
- [x] Shared negative keyword lists: adaugat `get_shared_negative_keyword_list`
- [x] Conversion actions: adaugat `get_conversion_action`
- [x] Conversion goals customer: adaugat `get_customer_conversion_goal`
- [x] Conversion goals campaign: adaugat `get_campaign_conversion_goal`
- [x] User lists: adaugat `get_user_list`
- [x] Custom audiences: adaugat `get_custom_audience`
- [x] Combined audiences: adaugat `get_combined_audience` (read-only)
- [x] Audience targeting links: adaugat `list_campaign_audience_targeting` + `list_ad_group_audience_targeting`
- [x] Campaign drafts: adaugat `get_campaign_draft`
- [x] Bidding strategies: adaugat `get_bidding_strategy`
- [x] Bidding seasonality adjustments: adaugat `get_bidding_seasonality_adjustment`
- [x] Bidding data exclusions: adaugat `get_bidding_data_exclusion`
- [x] Asset sets: adaugat `get_asset_set`
- [x] Asset set links: adaugat `get_asset_set_asset`
- [x] Campaign asset set links: adaugat `get_campaign_asset_set`
- [x] Asset group signals: adaugat `get_asset_group_signal`
- [x] Experiments: adaugat `get_experiment`
- [x] Reach planning: adaugat tool dedicat pentru `listPlannableProducts` (acum e doar intern in forecast)
- [x] Verticals: suport input extins pentru audience insights/hotel (fara query hardcodata)
- [x] Update `scripts/test-all-tools.ts` cu toate tool-urile noi din familiile implementate recent

## Ce lipseste pentru acoperire completa mutate v23 (31 familii)

### Ad / Ad Group extensions
- [x] `ad_group_ad_label_operation`
- [x] `ad_group_bid_modifier_operation`
- [x] `ad_group_criterion_customizer_operation`
- [x] `ad_group_criterion_label_operation`
- [x] `ad_group_customizer_operation`
- [x] `ad_group_label_operation`
- [x] `ad_operation`
- [x] `ad_parameter_operation`

### Audience / Asset / Campaign structure
- [x] `asset_group_listing_group_filter_operation`
- [x] `audience_operation`
- [x] `campaign_bid_modifier_operation`
- [x] `campaign_customizer_operation`
- [x] `campaign_group_operation`

### Conversions / bidding config avansat
- [x] `conversion_custom_variable_operation`
- [x] `conversion_goal_campaign_config_operation`
- [x] `conversion_value_rule_operation`
- [x] `conversion_value_rule_set_operation`
- [x] `custom_conversion_goal_operation`

### Customer-level entities
- [x] `customer_customizer_operation`
- [x] `customer_label_operation`
- [x] `customer_operation`
- [x] `customizer_attribute_operation`

### Experiments / planning / recommendations
- [x] `experiment_arm_operation`
- [x] `keyword_plan_ad_group_keyword_operation`
- [x] `keyword_plan_ad_group_operation`
- [x] `keyword_plan_campaign_keyword_operation`
- [x] `keyword_plan_campaign_operation`
- [x] `keyword_plan_operation`
- [x] `recommendation_subscription_operation`
- [x] `remarketing_action_operation`
- [x] `smart_campaign_setting_operation`

## Ce lipseste pentru acoperire list/get (paritate read)
- [x] `ad_group_ad_label` read tools (`list_*` + `get_*`)
- [x] `ad_group_bid_modifier` read tools (`list_*` + `get_*`)
- [x] `ad_group_criterion_customizer` read tools (`list_*` + `get_*`)
- [x] `ad_group_criterion_label` read tools (`list_*` + `get_*`)
- [x] `ad_group_customizer` read tools (`list_*` + `get_*`)
- [x] `ad_group_label` read tools (`list_*` + `get_*`)
- [x] `ad` read tools (`list_*` + `get_*`, inclusiv tipuri relevante)
- [x] `ad_parameter` read tools (`list_*` + `get_*`)
- [x] `asset_group_listing_group_filter` read tools (`list_*` + `get_*`)
- [x] `audience` read tools (`list_*` + `get_*`)
- [x] `campaign_bid_modifier` read tools (`list_*` + `get_*`)
- [x] `campaign_customizer` read tools (`list_*` + `get_*`)
- [x] `campaign_group` read tools (`list_*` + `get_*`)
- [x] `conversion_custom_variable` read tools (`list_*` + `get_*`)
- [x] `conversion_goal_campaign_config` read tools (`list_*` + `get_*`)
- [x] `conversion_value_rule` read tools (`list_*` + `get_*`)
- [x] `conversion_value_rule_set` read tools (`list_*` + `get_*`)
- [x] `custom_conversion_goal` read tools (`list_*` + `get_*`)
- [x] `customer_customizer` read tools (`list_*` + `get_*`)
- [x] `customer_label` read tools (`list_*` + `get_*`)
- [x] `customer` read tools (`list_*` + `get_*`)
- [x] `customizer_attribute` read tools (`list_*` + `get_*`)
- [x] `experiment_arm` read tools (`list_*` + `get_*`)
- [x] `keyword_plan_ad_group_keyword` read tools (`list_*` + `get_*`)
- [x] `keyword_plan_ad_group` read tools (`list_*` + `get_*`)
- [x] `keyword_plan_campaign_keyword` read tools (`list_*` + `get_*`)
- [x] `keyword_plan_campaign` read tools (`list_*` + `get_*`)
- [x] `keyword_plan` read tools (`list_*` + `get_*`)
- [x] `recommendation_subscription` read tools (`list_*` + `get_*`)
- [x] `remarketing_action` read tools (`list_*` + `get_*`)
- [x] `smart_campaign_setting` read tools (`list_*` + `get_*`)

## Regula de paritate per familie
- [x] Pentru fiecare familie noua: `list_*` + `get_*` + mutate permise de API (`create/update/remove` unde exista in API)
- [x] Daca API nu permite una din mutate (ex: nu are `update`), tool-ul trebuie documentat explicit in README
- [x] Toate tool-urile trebuie sa accepte `customerId` + `userId` si sa respecte RBAC wrapper

## Taskuri obligatorii dupa implementarea fiecarei familii
- [x] Inregistrare tool-uri in `src/index.ts`
- [x] Test functional per tool (read + mutate validate-only unde e cazul)
- [x] Extindere `scripts/test-all-tools.ts` pentru noile tool-uri
- [x] Update README cu lista tool-uri + exemple de input/output

## Criteriu final de inchidere
- [x] `31/31` familii mutate lipsa implementate
- [x] `31/31` familii read/list/get din lista de mai sus implementate
- [x] Smoke test complet fara fail-uri reale de cod (doar skip-uri de allowlist/billing/token scope)

