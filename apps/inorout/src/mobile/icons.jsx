// icons.jsx — maps the design-handoff icon names (m-data.jsx Icon registry) onto
// Phosphor icons at weight="thin", per CLAUDE.md's icon convention (the hygiene
// hook blocks any non-thin Phosphor weight). Screens port mechanically: the
// prototype's <Icon name="pulse" /> becomes <MIcon name="pulse" />.
//
// Colour/size come through as props; default colour is currentColor so tab/active
// state on the parent drives the glyph colour via the scoped tokens.

import {
  Pulse, Trophy, IdentificationCard, DotsThreeOutline,
  CalendarBlank, CurrencyGbp, Users, ShieldChevron, UsersThree,
  SquaresFour, Barbell, Package, Door, Globe, ListBullets, Trophy as Cup,
  Bell, QrCode, Key, MagnifyingGlass, CaretRight, CaretDown, CaretLeft,
  Check, X, Plus, Flag, Clock, Warning, Info, Television, Sparkle,
  ArrowClockwise, ArrowRight, Gear, SignOut, Phone, WhatsappLogo,
  EnvelopeSimple, MapPin, Star, House,
} from "@phosphor-icons/react";

// name → Phosphor component
const REGISTRY = {
  pulse: Pulse,
  calendar: CalendarBlank,
  pound: CurrencyGbp,
  users: Users,
  card: IdentificationCard,
  shield: ShieldChevron,
  whistle: UsersThree,
  grid: SquaresFour,
  figure: Barbell,
  box: Package,
  door: Door,
  globe: Globe,
  trophy: Trophy,
  list: ListBullets,
  cup: Cup,
  qr: QrCode,
  key: Key,
  search: MagnifyingGlass,
  bell: Bell,
  plus: Plus,
  check: Check,
  x: X,
  chevron: CaretRight,
  chevdown: CaretDown,
  chevleft: CaretLeft,
  dots: DotsThreeOutline,
  flag: Flag,
  clock: Clock,
  alert: Warning,
  info: Info,
  tv: Television,
  spark: Sparkle,
  refresh: ArrowClockwise,
  arrow: ArrowRight,
  cog: Gear,
  out: SignOut,
  phone: Phone,
  whatsapp: WhatsappLogo,
  mail: EnvelopeSimple,
  pin: MapPin,
  star: Star,
  house: House,
};

export default function MIcon({ name, size = 22, color = "currentColor", style }) {
  const Cmp = REGISTRY[name] || Pulse;
  return <Cmp size={size} color={color} weight="thin" style={style} />;
}

export { REGISTRY };
