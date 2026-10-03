// Inline SVG product illustrations (no external assets). Each function takes a
// unique suffix so gradient ids never collide when several SVGs share a page.

let counter = 0;
const uid = () => `g${++counter}`;

const wrap = (label, inner, viewBox = "0 0 400 300") =>
  `<svg viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}" preserveAspectRatio="xMidYMid slice">${inner}</svg>`;

const bg = (u, a, b) =>
  `<linearGradient id="bg-${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;

const steel = (u) =>
  `<linearGradient id="st-${u}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8E99A4"/><stop offset=".45" stop-color="#F1F4F7"/><stop offset=".7" stop-color="#C7CFD6"/><stop offset="1" stop-color="#7F8A95"/></linearGradient>`;

function pastaMachine() {
  const u = uid();
  return wrap(
    "Pasta machine",
    `<defs>${bg(u, "#FFF6E6", "#FBE2BF")}${steel(u)}</defs>
<rect width="400" height="300" fill="url(#bg-${u})"/>
<circle cx="70" cy="60" r="3" fill="#fff"/><circle cx="330" cy="40" r="2" fill="#fff"/><circle cx="350" cy="230" r="3" fill="#fff" opacity=".8"/>
<rect x="0" y="236" width="400" height="64" fill="#D9B48A"/><rect x="0" y="236" width="400" height="6" fill="#C79E70"/>
<ellipse cx="200" cy="240" rx="120" ry="8" fill="#000" opacity=".12"/>
<rect x="175" y="214" width="50" height="34" rx="4" fill="#59626B"/><rect x="186" y="246" width="28" height="20" rx="3" fill="#434A51"/>
<rect x="118" y="96" width="164" height="124" rx="16" fill="url(#st-${u})" stroke="#69737D" stroke-width="2"/>
<rect x="134" y="84" width="132" height="18" rx="7" fill="#D3DAE0" stroke="#69737D" stroke-width="2"/>
<rect x="150" y="89" width="100" height="6" rx="3" fill="#4A535B"/>
<circle cx="164" cy="158" r="24" fill="#DCE2E7" stroke="#69737D" stroke-width="2"/>
<circle cx="164" cy="158" r="6" fill="#69737D"/>
<g stroke="#69737D" stroke-width="2"><line x1="164" y1="138" x2="164" y2="143"/><line x1="182" y1="152" x2="178" y2="154"/><line x1="146" y1="152" x2="150" y2="154"/></g>
<rect x="208" y="126" width="56" height="10" rx="3" fill="#B9C2CA"/><rect x="208" y="144" width="56" height="10" rx="3" fill="#B9C2CA"/><rect x="208" y="162" width="56" height="10" rx="3" fill="#B9C2CA"/>
<path d="M282 156 h34 v-62" stroke="#3F464D" stroke-width="9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
<rect x="303" y="58" width="26" height="46" rx="11" fill="#B4642C"/><rect x="309" y="64" width="6" height="32" rx="3" fill="#D08548"/>
<path d="M140 218 C 132 240, 98 250, 54 254 L 58 272 C 112 268, 150 256, 168 218 Z" fill="#F7D98F" stroke="#E0B65A" stroke-width="2"/>
<path d="M70 262 C 100 258, 128 250, 148 232" stroke="#E9C46A" stroke-width="2" fill="none"/>
<g fill="#fff" opacity=".85"><circle cx="90" cy="282" r="2.5"/><circle cx="110" cy="276" r="1.8"/><circle cx="250" cy="280" r="2.2"/><circle cx="280" cy="270" r="1.6"/><circle cx="60" cy="285" r="1.6"/></g>`,
  );
}

function chefKnife() {
  const u = uid();
  return wrap(
    "Chef's knife",
    `<defs>${bg(u, "#2C3540", "#1B2229")}
<linearGradient id="bl-${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F5F7F9"/><stop offset=".55" stop-color="#C9D1D9"/><stop offset="1" stop-color="#8A96A2"/></linearGradient></defs>
<rect width="400" height="300" fill="url(#bg-${u})"/>
<rect x="0" y="0" width="400" height="300" fill="#fff" opacity=".02"/>
<g transform="rotate(-18 200 150)">
<ellipse cx="200" cy="196" rx="170" ry="10" fill="#000" opacity=".35"/>
<path d="M58 150 C 120 136, 220 128, 300 134 L 300 172 L 80 172 C 66 170, 58 162, 58 150 Z" fill="url(#bl-${u})"/>
<path d="M58 150 C 120 136, 220 128, 300 134 L 300 140 C 220 136, 130 142, 64 156 Z" fill="#fff" opacity=".7"/>
<g stroke="#9AA6B2" stroke-width="1.2" fill="none" opacity=".7">
<path d="M110 168 C 140 150, 160 166, 190 150 S 240 160, 270 146"/>
<path d="M130 170 C 160 156, 180 170, 210 156 S 255 166, 290 152"/>
<path d="M160 171 C 190 160, 205 172, 235 160 S 270 168, 298 160"/></g>
<rect x="296" y="128" width="14" height="48" rx="3" fill="#B8C1CA"/>
<path d="M310 136 L 388 140 C 396 141, 398 165, 388 166 L 310 170 Z" fill="#14181C"/>
<circle cx="332" cy="153" r="4" fill="#C9D1D9"/><circle cx="356" cy="153" r="4" fill="#C9D1D9"/><circle cx="378" cy="153" r="3.5" fill="#C9D1D9"/>
</g>
<g fill="#7FB069"><path d="M40 250 c 20 -20, 50 -10, 56 6 c -20 6, -44 6, -56 -6 z"/><path d="M78 268 c 16 -22, 46 -18, 52 -2 c -18 8, -40 10, -52 2 z" fill="#5E9150"/></g>
<g fill="#E4572E"><circle cx="330" cy="250" r="20"/><circle cx="352" cy="262" r="14" fill="#C9432A"/></g>
<path d="M326 232 l4 -8 l4 8" stroke="#4E8A3E" stroke-width="3" fill="none"/>`,
  );
}

function castIronPan() {
  const u = uid();
  return wrap(
    "Cast-iron skillet",
    `<defs>${bg(u, "#F4EDE4", "#E7DCCD")}
<radialGradient id="ir-${u}" cx=".45" cy=".4" r=".7"><stop offset="0" stop-color="#4A4F55"/><stop offset=".8" stop-color="#25292D"/><stop offset="1" stop-color="#16191C"/></radialGradient></defs>
<rect width="400" height="300" fill="url(#bg-${u})"/>
<g opacity=".25" stroke="#C9B9A3" stroke-width="1"><line x1="0" y1="60" x2="400" y2="60"/><line x1="0" y1="140" x2="400" y2="140"/><line x1="0" y1="220" x2="400" y2="220"/></g>
<ellipse cx="180" cy="168" rx="122" ry="118" fill="#000" opacity=".15"/>
<rect x="276" y="138" width="118" height="30" rx="15" fill="#1E2226"/><circle cx="376" cy="153" r="7" fill="#E7DCCD"/>
<circle cx="176" cy="158" r="118" fill="#1B1E21"/>
<circle cx="176" cy="158" r="104" fill="url(#ir-${u})"/>
<path d="M120 90 C 160 70, 220 74, 248 104" stroke="#fff" stroke-width="5" opacity=".08" fill="none" stroke-linecap="round"/>
<path d="M120 160 c -10 -40, 40 -60, 70 -40 c 30 -10, 60 20, 40 50 c 10 30, -40 50, -64 30 c -30 10, -56 -16, -46 -40 z" fill="#FFFFFF"/>
<circle cx="168" cy="150" r="22" fill="#F7B32B"/><circle cx="162" cy="144" r="6" fill="#FFD36E"/>
<path d="M210 196 c 14 -6, 30 -2, 40 8 c -12 10, -30 10, -40 -8 z" fill="#C0392B"/>
<path d="M222 120 c 10 -4, 22 4, 22 14 c -10 2, -20 -4, -22 -14 z" fill="#6BA34B"/>
<path d="M232 136 c 8 -8, 22 -6, 26 4 c -10 6, -22 4, -26 -4 z" fill="#4F8A3A"/>
<g fill="#3D3A36"><circle cx="140" cy="200" r="2"/><circle cx="150" cy="206" r="1.6"/><circle cx="196" cy="118" r="1.8"/><circle cx="204" cy="190" r="1.4"/></g>`,
  );
}

function oliveOil() {
  const u = uid();
  return wrap(
    "Extra virgin olive oil",
    `<defs>${bg(u, "#EEF3E2", "#DCE6C6")}
<linearGradient id="gl-${u}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3E5A1E"/><stop offset=".4" stop-color="#7A9A2E"/><stop offset="1" stop-color="#3A541B"/></linearGradient></defs>
<rect width="400" height="300" fill="url(#bg-${u})"/>
<rect x="0" y="250" width="400" height="50" fill="#C8B18E"/>
<ellipse cx="200" cy="252" rx="70" ry="8" fill="#000" opacity=".15"/>
<rect x="186" y="34" width="28" height="22" rx="4" fill="#2F2F2F"/><rect x="190" y="56" width="20" height="30" fill="#5B7A23"/>
<path d="M190 86 C 190 104, 156 112, 156 140 L 156 236 C 156 246, 166 252, 176 252 L 224 252 C 234 252, 244 246, 244 236 L 244 140 C 244 112, 210 104, 210 86 Z" fill="url(#gl-${u})"/>
<path d="M166 132 L 166 238" stroke="#fff" stroke-width="5" opacity=".25" stroke-linecap="round"/>
<rect x="164" y="152" width="72" height="66" rx="6" fill="#FBF6E9"/>
<rect x="172" y="162" width="56" height="6" rx="3" fill="#5B7A23"/><rect x="178" y="176" width="44" height="4" rx="2" fill="#B9A57C"/><rect x="178" y="186" width="44" height="4" rx="2" fill="#B9A57C"/>
<ellipse cx="200" cy="204" rx="10" ry="6" fill="#7A9A2E"/>
<path d="M40 220 C 70 180, 100 160, 140 150" stroke="#6B5434" stroke-width="4" fill="none" stroke-linecap="round"/>
<g fill="#6E8F3A"><ellipse cx="70" cy="186" rx="18" ry="6" transform="rotate(-40 70 186)"/><ellipse cx="96" cy="168" rx="18" ry="6" transform="rotate(20 96 168)"/><ellipse cx="118" cy="156" rx="16" ry="5" transform="rotate(-30 118 156)"/></g>
<g fill="#3B3F1E"><ellipse cx="84" cy="196" rx="9" ry="12"/><ellipse cx="108" cy="182" rx="8" ry="11" fill="#55602A"/></g>
<path d="M296 250 c 0 -30, 40 -30, 40 0 z" fill="#E9DFC7"/><ellipse cx="316" cy="244" rx="16" ry="4" fill="#C9A43A"/>
<g fill="#556B2F"><ellipse cx="350" cy="232" rx="7" ry="9"/><ellipse cx="364" cy="240" rx="7" ry="9" fill="#3B3F1E"/></g>`,
  );
}

function standMixer() {
  const u = uid();
  return wrap(
    "Stand mixer",
    `<defs>${bg(u, "#FDEDEA", "#F6D5CF")}${steel(u)}
<linearGradient id="rd-${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E5533D"/><stop offset="1" stop-color="#A9301F"/></linearGradient></defs>
<rect width="400" height="300" fill="url(#bg-${u})"/>
<rect x="0" y="252" width="400" height="48" fill="#EAD9D2"/>
<ellipse cx="200" cy="254" rx="130" ry="9" fill="#000" opacity=".14"/>
<rect x="100" y="226" width="200" height="28" rx="12" fill="url(#rd-${u})"/>
<path d="M120 230 L 120 120 C 120 100, 136 88, 156 88 L 170 88 L 170 230 Z" fill="url(#rd-${u})"/>
<path d="M120 112 C 120 74, 160 62, 220 62 L 280 62 C 304 62, 318 78, 318 96 C 318 116, 302 128, 280 128 L 150 128 C 132 128, 120 124, 120 112 Z" fill="url(#rd-${u})"/>
<path d="M150 74 C 190 68, 250 68, 290 74" stroke="#fff" stroke-width="5" opacity=".35" fill="none" stroke-linecap="round"/>
<circle cx="300" cy="95" r="10" fill="url(#st-${u})"/>
<rect x="136" y="150" width="20" height="6" rx="3" fill="url(#st-${u})"/>
<rect x="236" y="128" width="8" height="40" fill="#8E99A4"/>
<path d="M190 166 L 290 166 L 280 222 C 278 232, 270 236, 260 236 L 220 236 C 210 236, 202 232, 200 222 Z" fill="url(#st-${u})" stroke="#7F8A95" stroke-width="2"/>
<path d="M200 176 C 220 170, 260 170, 280 176" stroke="#fff" stroke-width="3" opacity=".7" fill="none"/>
<path d="M228 160 c 6 14, 18 14, 24 0" stroke="#5F6A75" stroke-width="3" fill="none"/>
<path d="M206 172 c 12 -12, 24 4, 36 -6 c 12 -8, 24 6, 34 -2" stroke="#F3E3C3" stroke-width="10" fill="none" stroke-linecap="round"/>`,
  );
}

function espressoMachine() {
  const u = uid();
  return wrap(
    "Espresso machine",
    `<defs>${bg(u, "#EFE8E1", "#D9CEC2")}${steel(u)}</defs>
<rect width="400" height="300" fill="url(#bg-${u})"/>
<rect x="0" y="256" width="400" height="44" fill="#BFAE9C"/>
<ellipse cx="200" cy="258" rx="140" ry="8" fill="#000" opacity=".16"/>
<rect x="84" y="56" width="232" height="200" rx="14" fill="url(#st-${u})" stroke="#6F7A85" stroke-width="2"/>
<rect x="84" y="56" width="232" height="34" rx="14" fill="#2B2F33"/><rect x="84" y="76" width="232" height="14" fill="#2B2F33"/>
<rect x="100" y="104" width="78" height="54" rx="8" fill="#1F2327"/>
<circle cx="139" cy="131" r="20" fill="#F4F1EA"/><path d="M139 131 L 150 120" stroke="#C0392B" stroke-width="3" stroke-linecap="round"/><circle cx="139" cy="131" r="3" fill="#2B2F33"/>
<circle cx="214" cy="122" r="9" fill="#2B2F33"/><circle cx="244" cy="122" r="9" fill="#2B2F33"/><circle cx="274" cy="122" r="9" fill="#C0392B"/>
<rect x="196" y="166" width="60" height="16" rx="5" fill="#3A4046"/>
<path d="M226 182 L 226 192" stroke="#3A4046" stroke-width="10"/>
<path d="M216 190 L 300 190 C 310 190, 312 200, 302 202 L 216 202 Z" fill="#2B2F33"/>
<path d="M290 120 L 300 120 L 300 196" stroke="#6F7A85" stroke-width="5" fill="none"/>
<rect x="196" y="238" width="80" height="10" rx="3" fill="#5F6A75"/>
<path d="M206 206 L 246 206 L 242 232 C 241 236, 238 238, 234 238 L 218 238 C 214 238, 211 236, 210 232 Z" fill="#FFFFFF" stroke="#C9C1B6" stroke-width="2"/>
<path d="M246 214 c 10 0, 10 14, 0 14" stroke="#C9C1B6" stroke-width="3" fill="none"/>
<ellipse cx="226" cy="208" rx="18" ry="3" fill="#6B3F1F"/>
<g stroke="#fff" stroke-width="3" fill="none" opacity=".75" stroke-linecap="round"><path d="M216 200 c -6 -10, 6 -14, 0 -24"/><path d="M232 198 c -6 -10, 6 -14, 0 -24"/></g>
<rect x="100" y="176" width="70" height="66" rx="6" fill="#DDE3E8" stroke="#8E99A4"/>
<path d="M342 254 c 0 -26, 30 -26, 30 0 z" fill="#5C3A21"/><g fill="#3E2615"><ellipse cx="350" cy="244" rx="3" ry="2"/><ellipse cx="360" cy="248" rx="3" ry="2"/><ellipse cx="358" cy="238" rx="3" ry="2"/></g>`,
  );
}

function cuttingBoard() {
  const u = uid();
  return wrap(
    "Walnut cutting board",
    `<defs>${bg(u, "#F1EEE8", "#E2DCD1")}
<linearGradient id="wd-${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8A5A36"/><stop offset=".5" stop-color="#6E4428"/><stop offset="1" stop-color="#55331D"/></linearGradient></defs>
<rect width="400" height="300" fill="url(#bg-${u})"/>
<rect x="56" y="58" width="300" height="196" rx="22" fill="#000" opacity=".14" transform="translate(6 8)"/>
<rect x="56" y="58" width="300" height="196" rx="22" fill="url(#wd-${u})"/>
<g stroke="#4A2C18" stroke-width="1.5" fill="none" opacity=".45">
<path d="M70 90 C 140 80, 220 100, 340 86"/><path d="M70 120 C 150 112, 230 130, 340 118"/><path d="M70 150 C 130 142, 240 162, 340 150"/><path d="M70 182 C 160 174, 220 194, 340 182"/><path d="M70 214 C 140 206, 250 222, 340 212"/>
<ellipse cx="260" cy="134" rx="16" ry="7"/></g>
<circle cx="326" cy="86" r="10" fill="url(#bg-${u})"/>
<g><circle cx="140" cy="170" r="34" fill="#E2412C"/><circle cx="140" cy="170" r="27" fill="#F06A4F"/>
<g fill="#F7D46A"><ellipse cx="128" cy="160" rx="5" ry="3"/><ellipse cx="152" cy="162" rx="5" ry="3"/><ellipse cx="132" cy="182" rx="5" ry="3"/><ellipse cx="150" cy="180" rx="5" ry="3"/></g>
<path d="M140 146 L 140 194 M 116 170 L 164 170" stroke="#E2412C" stroke-width="3"/></g>
<g><circle cx="196" cy="190" r="26" fill="#E2412C"/><circle cx="196" cy="190" r="20" fill="#F06A4F"/><path d="M196 172 L 196 208 M 178 190 L 214 190" stroke="#E2412C" stroke-width="3"/></g>
<g fill="#4F9A3E"><path d="M240 196 c 10 -30, 40 -30, 50 -4 c -18 14, -38 14, -50 4 z"/><path d="M262 214 c 18 -20, 46 -10, 46 10 c -20 6, -38 4, -46 -10 z" fill="#3D7F30"/></g>
<path d="M248 196 C 262 194, 276 192, 288 192" stroke="#2F6524" stroke-width="1.5" fill="none"/>`,
  );
}

function spiceSet() {
  const u = uid();
  const jar = (x, color, dots) =>
    `<g><rect x="${x}" y="92" width="58" height="16" rx="4" fill="#2E2E2E"/><rect x="${x + 2}" y="106" width="54" height="104" rx="10" fill="#FFFFFF" opacity=".55" stroke="#C9C1B6" stroke-width="2"/>
<rect x="${x + 6}" y="130" width="46" height="76" rx="7" fill="${color}"/>${dots}
<rect x="${x + 10}" y="150" width="38" height="24" rx="3" fill="#FBF6E9"/><rect x="${x + 16}" y="158" width="26" height="4" rx="2" fill="#8B7B65"/>
<path d="M${x + 10} 116 L ${x + 10} 200" stroke="#fff" stroke-width="4" opacity=".6" stroke-linecap="round"/></g>`;
  const specks = (x, c) =>
    `<g fill="${c}">${[0, 1, 2, 3, 4, 5].map((i) => `<circle cx="${x + 12 + ((i * 17) % 36)}" cy="${186 + ((i * 7) % 16)}" r="1.6"/>`).join("")}</g>`;
  return wrap(
    "Spice set",
    `<defs>${bg(u, "#FBF3E4", "#F1E1C4")}</defs>
<rect width="400" height="300" fill="url(#bg-${u})"/>
<rect x="36" y="214" width="328" height="18" rx="4" fill="#9C6B3F"/><rect x="36" y="228" width="328" height="8" fill="#7E5430"/>
<rect x="44" y="236" width="10" height="26" fill="#7E5430"/><rect x="346" y="236" width="10" height="26" fill="#7E5430"/>
${jar(52, "#C8432B", specks(52, "#8F2B19"))}
${jar(126, "#E3A21A", specks(126, "#B57A08"))}
${jar(200, "#6E8B3D", specks(200, "#4A6326"))}
${jar(274, "#3B3430", specks(274, "#6B615A"))}
<g fill="#C8432B"><circle cx="100" cy="264" r="3"/><circle cx="112" cy="270" r="2.4"/></g><g fill="#E3A21A"><circle cx="300" cy="268" r="2.6"/><circle cx="314" cy="262" r="2"/></g>`,
  );
}

function hero() {
  const u = uid();
  return wrap(
    "Fresh pasta on a wooden table",
    `<defs>${bg(u, "#F7E6CC", "#EFCF9F")}
<radialGradient id="bw-${u}" cx=".5" cy=".4" r=".6"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#E9E2D6"/></radialGradient></defs>
<rect width="640" height="420" fill="url(#bg-${u})"/>
<g opacity=".18" stroke="#A8743E" stroke-width="2" fill="none"><path d="M0 120 C 200 100, 420 140, 640 110"/><path d="M0 220 C 220 200, 400 240, 640 210"/><path d="M0 320 C 200 300, 440 340, 640 310"/></g>
<ellipse cx="300" cy="250" rx="190" ry="120" fill="#000" opacity=".12"/>
<ellipse cx="292" cy="238" rx="188" ry="118" fill="url(#bw-${u})"/>
<ellipse cx="292" cy="230" rx="150" ry="88" fill="#F3EDE3"/>
<g stroke="#EFC56A" stroke-width="7" fill="none" stroke-linecap="round">
<path d="M190 230 C 220 180, 300 170, 360 200 S 400 270, 320 280 S 200 270, 230 220"/>
<path d="M210 240 C 240 200, 320 196, 360 226 S 360 280, 300 274"/>
<path d="M230 210 C 270 180, 340 190, 370 230"/>
<path d="M200 250 C 230 270, 300 290, 380 250"/>
<path d="M250 200 C 280 220, 330 230, 350 250"/></g>
<g stroke="#F7D98F" stroke-width="3" fill="none" stroke-linecap="round" opacity=".9"><path d="M214 236 C 250 196, 320 192, 356 222"/><path d="M226 254 C 270 270, 330 272, 368 246"/></g>
<g fill="#4F9A3E"><path d="M300 190 c 14 -20, 40 -18, 44 2 c -16 10, -34 10, -44 -2 z"/><path d="M318 176 c 16 -14, 38 -4, 36 12 c -16 4, -30 0, -36 -12 z" fill="#3D7F30"/></g>
<g fill="#F3E3C3"><circle cx="260" cy="214" r="3"/><circle cx="276" cy="226" r="2"/><circle cx="340" cy="244" r="2.4"/><circle cx="300" cy="256" r="2"/></g>
<g><circle cx="520" cy="300" r="36" fill="#D8402A"/><circle cx="560" cy="330" r="28" fill="#E55A3F"/><circle cx="500" cy="350" r="24" fill="#C8352A"/>
<path d="M512 266 l8 -10 l8 10 M 552 304 l8 -8 l8 8" stroke="#3D7F30" stroke-width="4" fill="none"/></g>
<rect x="420" y="70" width="230" height="26" rx="13" fill="#C9935A" transform="rotate(-20 520 80)"/>
<rect x="400" y="80" width="40" height="18" rx="9" fill="#A8743E" transform="rotate(-20 520 80)"/>
<g fill="#FFFFFF" opacity=".9"><circle cx="90" cy="330" r="4"/><circle cx="120" cy="346" r="3"/><circle cx="70" cy="360" r="2.5"/><circle cx="140" cy="320" r="2"/></g>
<path d="M40 90 C 70 60, 110 60, 120 90 C 100 110, 60 110, 40 90 Z" fill="#F7F0E2"/><g fill="#F6C94A"><circle cx="80" cy="86" r="10"/></g>`,
    "0 0 640 420",
  );
}

export const illustrations = {
  "pasta-machine": pastaMachine,
  "chef-knife": chefKnife,
  "cast-iron-pan": castIronPan,
  "olive-oil": oliveOil,
  "stand-mixer": standMixer,
  "espresso-machine": espressoMachine,
  "cutting-board": cuttingBoard,
  "spice-set": spiceSet,
  hero,
};

export function productSvg(id) {
  const fn = illustrations[id];
  return fn ? fn() : "";
}
