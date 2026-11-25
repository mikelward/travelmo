package app.travelmo.ui

import app.travelmo.core.Segment
import app.travelmo.core.brandLogoIds
import app.travelmo.shared.*
import org.jetbrains.compose.resources.DrawableResource

/**
 * The brands whose logos the app bundles, by brands.ts's id: the logo and, where it differs, its version for a dark
 * background. From Simple Icons, SVG Logos and Arcticons, as the web app's (apps/web/public/brands/NOTICE.md).
 */
internal val brandLogos: Map<String, Pair<DrawableResource, DrawableResource?>> = mapOf(
    "airbnb" to (Res.drawable.brand_airbnb to null),
    "vrbo" to (Res.drawable.brand_vrbo to Res.drawable.brand_vrbo_dark),
    "booking" to (Res.drawable.brand_booking to Res.drawable.brand_booking_dark),
    "expedia" to (Res.drawable.brand_expedia to Res.drawable.brand_expedia_dark),
    "hotelscom" to (Res.drawable.brand_hotelscom to null),
    "tripcom" to (Res.drawable.brand_tripcom to null),
    "agoda" to (Res.drawable.brand_agoda to Res.drawable.brand_agoda_dark),
    "hostelworld" to (Res.drawable.brand_hostelworld to Res.drawable.brand_hostelworld_dark),
    "tripadvisor" to (Res.drawable.brand_tripadvisor to null),
    "trivago" to (Res.drawable.brand_trivago to Res.drawable.brand_trivago_dark),
    "hilton" to (Res.drawable.brand_hilton to Res.drawable.brand_hilton_dark),
    "marriott" to (Res.drawable.brand_marriott to Res.drawable.brand_marriott_dark),
    "ritzcarlton" to (Res.drawable.brand_ritzcarlton to Res.drawable.brand_ritzcarlton_dark),
    "ihg" to (Res.drawable.brand_ihg to Res.drawable.brand_ihg_dark),
    "wyndham" to (Res.drawable.brand_wyndham to Res.drawable.brand_wyndham_dark),
    "radisson" to (Res.drawable.brand_radisson to Res.drawable.brand_radisson_dark),
    "accor" to (Res.drawable.brand_accor to Res.drawable.brand_accor_dark),
    "sixt" to (Res.drawable.brand_sixt to Res.drawable.brand_sixt_dark),
    "enterprise" to (Res.drawable.brand_enterprise to Res.drawable.brand_enterprise_dark),
    "turo" to (Res.drawable.brand_turo to Res.drawable.brand_turo_dark),
    "zipcar" to (Res.drawable.brand_zipcar to Res.drawable.brand_zipcar_dark),
    "uber" to (Res.drawable.brand_uber to Res.drawable.brand_uber_dark),
    "lyft" to (Res.drawable.brand_lyft to null),
    "bolt" to (Res.drawable.brand_bolt to Res.drawable.brand_bolt_dark),
    "grab" to (Res.drawable.brand_grab to null),
    "cabify" to (Res.drawable.brand_cabify to Res.drawable.brand_cabify_dark),
    "eurostar" to (Res.drawable.brand_eurostar to Res.drawable.brand_eurostar_dark),
    "trainline" to (Res.drawable.brand_trainline to Res.drawable.brand_trainline_dark),
    "amtrak" to (Res.drawable.brand_amtrak to Res.drawable.brand_amtrak_dark),
    "deutschebahn" to (Res.drawable.brand_deutschebahn to Res.drawable.brand_deutschebahn_dark),
    "sncf" to (Res.drawable.brand_sncf to Res.drawable.brand_sncf_dark),
    "ouigo" to (Res.drawable.brand_ouigo to Res.drawable.brand_ouigo_dark),
    "obb" to (Res.drawable.brand_obb to Res.drawable.brand_obb_dark),
    "sbb" to (Res.drawable.brand_sbb to Res.drawable.brand_sbb_dark),
    "renfe" to (Res.drawable.brand_renfe to Res.drawable.brand_renfe_dark),
    "trenitalia" to (Res.drawable.brand_trenitalia to Res.drawable.brand_trenitalia_dark),
    "italo" to (Res.drawable.brand_italo to Res.drawable.brand_italo_dark),
    "nationalrail" to (Res.drawable.brand_nationalrail to Res.drawable.brand_nationalrail_dark),
    "lner" to (Res.drawable.brand_lner to Res.drawable.brand_lner_dark),
    "avanti" to (Res.drawable.brand_avanti to Res.drawable.brand_avanti_dark),
    "flixbus" to (Res.drawable.brand_flixbus to Res.drawable.brand_flixbus_dark),
    "opentable" to (Res.drawable.brand_opentable to Res.drawable.brand_opentable_dark),
    "getyourguide" to (Res.drawable.brand_getyourguide to null),
    "klook" to (Res.drawable.brand_klook to null),
    "eventbrite" to (Res.drawable.brand_eventbrite to null),
    "ticketmaster" to (Res.drawable.brand_ticketmaster to Res.drawable.brand_ticketmaster_dark),
    "seatgeek" to (Res.drawable.brand_seatgeek to null),
    "stubhub" to (Res.drawable.brand_stubhub to Res.drawable.brand_stubhub_dark),
    "disneyland" to (Res.drawable.brand_disneyland to Res.drawable.brand_disneyland_dark),
    "universal" to (Res.drawable.brand_universal to Res.drawable.brand_universal_dark),
)

/** The logo a booking's row shows: its brand's own, else its parent's (brandLogoIds); null when there is none. */
internal fun brandLogo(segment: Segment): Pair<DrawableResource, DrawableResource?>? =
    brandLogoIds(segment).firstNotNullOfOrNull { brandLogos[it] }
