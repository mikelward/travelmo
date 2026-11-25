package app.travelmo.ui

import app.travelmo.shared.*
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.unit.Dp
import org.jetbrains.compose.resources.DrawableResource
import org.jetbrains.compose.resources.painterResource

/**
 * The airlines whose logos the app bundles, by IATA code: the logo and, where there is one, its version for a dark
 * background. From the Soaring Symbols collection, as the web app's (apps/web/public/airlines/NOTICE.md).
 */
internal val airlineLogos: Map<String, Pair<DrawableResource, DrawableResource?>> = mapOf(
    "2K" to (Res.drawable.airline_2k to Res.drawable.airline_2k_dark),
    "3U" to (Res.drawable.airline_3u to Res.drawable.airline_3u_dark),
    "5J" to (Res.drawable.airline_5j to Res.drawable.airline_5j_dark),
    "6E" to (Res.drawable.airline_6e to Res.drawable.airline_6e_dark),
    "A3" to (Res.drawable.airline_a3 to Res.drawable.airline_a3_dark),
    "AA" to (Res.drawable.airline_aa to Res.drawable.airline_aa_dark),
    "AC" to (Res.drawable.airline_ac to Res.drawable.airline_ac_dark),
    "AD" to (Res.drawable.airline_ad to null),
    "AF" to (Res.drawable.airline_af to Res.drawable.airline_af_dark),
    "AI" to (Res.drawable.airline_ai to Res.drawable.airline_ai_dark),
    "AM" to (Res.drawable.airline_am to Res.drawable.airline_am_dark),
    "AR" to (Res.drawable.airline_ar to Res.drawable.airline_ar_dark),
    "AS" to (Res.drawable.airline_as to null),
    "AT" to (Res.drawable.airline_at to Res.drawable.airline_at_dark),
    "AV" to (Res.drawable.airline_av to Res.drawable.airline_av_dark),
    "AY" to (Res.drawable.airline_ay to Res.drawable.airline_ay_dark),
    "BA" to (Res.drawable.airline_ba to Res.drawable.airline_ba_dark),
    "BR" to (Res.drawable.airline_br to Res.drawable.airline_br_dark),
    "CA" to (Res.drawable.airline_ca to Res.drawable.airline_ca_dark),
    "CI" to (Res.drawable.airline_ci to null),
    "CM" to (Res.drawable.airline_cm to Res.drawable.airline_cm_dark),
    "CX" to (Res.drawable.airline_cx to Res.drawable.airline_cx_dark),
    "CZ" to (Res.drawable.airline_cz to Res.drawable.airline_cz_dark),
    "D8" to (Res.drawable.airline_d8 to Res.drawable.airline_d8_dark),
    "DE" to (Res.drawable.airline_de to Res.drawable.airline_de_dark),
    "DL" to (Res.drawable.airline_dl to Res.drawable.airline_dl_dark),
    "DY" to (Res.drawable.airline_dy to Res.drawable.airline_dy_dark),
    "EI" to (Res.drawable.airline_ei to Res.drawable.airline_ei_dark),
    "EK" to (Res.drawable.airline_ek to Res.drawable.airline_ek_dark),
    "EN" to (Res.drawable.airline_en to Res.drawable.airline_en_dark),
    "ET" to (Res.drawable.airline_et to Res.drawable.airline_et_dark),
    "EW" to (Res.drawable.airline_ew to Res.drawable.airline_ew_dark),
    "F9" to (Res.drawable.airline_f9 to Res.drawable.airline_f9_dark),
    "FI" to (Res.drawable.airline_fi to Res.drawable.airline_fi_dark),
    "FJ" to (Res.drawable.airline_fj to Res.drawable.airline_fj_dark),
    "FR" to (Res.drawable.airline_fr to Res.drawable.airline_fr_dark),
    "G3" to (Res.drawable.airline_g3 to null),
    "GA" to (Res.drawable.airline_ga to Res.drawable.airline_ga_dark),
    "GF" to (Res.drawable.airline_gf to Res.drawable.airline_gf_dark),
    "HU" to (Res.drawable.airline_hu to Res.drawable.airline_hu_dark),
    "HV" to (Res.drawable.airline_hv to Res.drawable.airline_hv_dark),
    "IB" to (Res.drawable.airline_ib to Res.drawable.airline_ib_dark),
    "JJ" to (Res.drawable.airline_jj to Res.drawable.airline_jj_dark),
    "JL" to (Res.drawable.airline_jl to Res.drawable.airline_jl_dark),
    "JQ" to (Res.drawable.airline_jq to Res.drawable.airline_jq_dark),
    "JU" to (Res.drawable.airline_ju to Res.drawable.airline_ju_dark),
    "KC" to (Res.drawable.airline_kc to Res.drawable.airline_kc_dark),
    "KE" to (Res.drawable.airline_ke to Res.drawable.airline_ke_dark),
    "KL" to (Res.drawable.airline_kl to Res.drawable.airline_kl_dark),
    "KQ" to (Res.drawable.airline_kq to Res.drawable.airline_kq_dark),
    "KU" to (Res.drawable.airline_ku to Res.drawable.airline_ku_dark),
    "LA" to (Res.drawable.airline_la to Res.drawable.airline_la_dark),
    "LH" to (Res.drawable.airline_lh to Res.drawable.airline_lh_dark),
    "LO" to (Res.drawable.airline_lo to Res.drawable.airline_lo_dark),
    "LS" to (Res.drawable.airline_ls to Res.drawable.airline_ls_dark),
    "LX" to (Res.drawable.airline_lx to Res.drawable.airline_lx_dark),
    "LY" to (Res.drawable.airline_ly to Res.drawable.airline_ly_dark),
    "MF" to (Res.drawable.airline_mf to Res.drawable.airline_mf_dark),
    "MH" to (Res.drawable.airline_mh to Res.drawable.airline_mh_dark),
    "MK" to (Res.drawable.airline_mk to Res.drawable.airline_mk_dark),
    "MS" to (Res.drawable.airline_ms to Res.drawable.airline_ms_dark),
    "MU" to (Res.drawable.airline_mu to null),
    "NZ" to (Res.drawable.airline_nz to Res.drawable.airline_nz_dark),
    "OS" to (Res.drawable.airline_os to Res.drawable.airline_os_dark),
    "OZ" to (Res.drawable.airline_oz to Res.drawable.airline_oz_dark),
    "PC" to (Res.drawable.airline_pc to Res.drawable.airline_pc_dark),
    "PG" to (Res.drawable.airline_pg to Res.drawable.airline_pg_dark),
    "PR" to (Res.drawable.airline_pr to Res.drawable.airline_pr_dark),
    "QF" to (Res.drawable.airline_qf to Res.drawable.airline_qf_dark),
    "QR" to (Res.drawable.airline_qr to Res.drawable.airline_qr_dark),
    "RO" to (Res.drawable.airline_ro to Res.drawable.airline_ro_dark),
    "S7" to (Res.drawable.airline_s7 to Res.drawable.airline_s7_dark),
    "SN" to (Res.drawable.airline_sn to Res.drawable.airline_sn_dark),
    "SQ" to (Res.drawable.airline_sq to Res.drawable.airline_sq_dark),
    "SV" to (Res.drawable.airline_sv to Res.drawable.airline_sv_dark),
    "TG" to (Res.drawable.airline_tg to Res.drawable.airline_tg_dark),
    "TK" to (Res.drawable.airline_tk to Res.drawable.airline_tk_dark),
    "TP" to (Res.drawable.airline_tp to null),
    "TS" to (Res.drawable.airline_ts to Res.drawable.airline_ts_dark),
    "U2" to (Res.drawable.airline_u2 to Res.drawable.airline_u2_dark),
    "UA" to (Res.drawable.airline_ua to Res.drawable.airline_ua_dark),
    "UX" to (Res.drawable.airline_ux to Res.drawable.airline_ux_dark),
    "V7" to (Res.drawable.airline_v7 to Res.drawable.airline_v7_dark),
    "VA" to (Res.drawable.airline_va to Res.drawable.airline_va_dark),
    "VN" to (Res.drawable.airline_vn to Res.drawable.airline_vn_dark),
    "VS" to (Res.drawable.airline_vs to Res.drawable.airline_vs_dark),
    "WN" to (Res.drawable.airline_wn to null),
    "WS" to (Res.drawable.airline_ws to Res.drawable.airline_ws_dark),
    "WY" to (Res.drawable.airline_wy to Res.drawable.airline_wy_dark),
    "XY" to (Res.drawable.airline_xy to Res.drawable.airline_xy_dark),
    "ZH" to (Res.drawable.airline_zh to Res.drawable.airline_zh_dark),
)

/** The airline's logo beside its name, as the trip page and a booking's page head a flight; nothing for an airline without one. */
@Composable
internal fun AirlineLogo(code: String?, size: Dp) {
    val (light, dark) = code?.let { airlineLogos[it] } ?: return
    val onDark = MaterialTheme.colorScheme.surface.luminance() < 0.5f
    Image(painterResource(if (onDark) dark ?: light else light), contentDescription = null, modifier = Modifier.size(size))
}
