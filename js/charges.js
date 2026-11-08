/*
 * Tax and fee names printed on US restaurant receipts.
 *
 * Places with their own names come first, by state and then city, in alphabetical
 * order. Places that only print "Sales Tax" or "Tax" aren't listed: any line with the
 * word "tax" in it is already read as tax. After the places comes a list of names
 * used anywhere in the country, also in alphabetical order.
 *
 * Each entry is a regular-expression fragment matched against the lowercased line.
 *   tax   adds to the tax
 *   fee   adds to the fees (split like tax, by what each person ordered)
 *   item  stays a row on the bill, so it can be given to whoever it was for
 */

export const PLACES = [
  { place: 'Arkansas', tax: ['a\\s*&\\s*p', 'advertising\\s+(and|&)\\s+promotion'] },
  { place: 'California', fee: ['crv', 'health\\s+mandate', 'kitchen\\s+appreciation'] },
  { place: 'California: Los Angeles', fee: ['benefits?\\s+surcharge', 'healthy\\s+l\\.?\\s*a\\.?'] },
  { place: 'California: San Francisco', fee: ['hcso', 'healthy\\s+s\\.?\\s*f\\.?', 'sf\\s*(hm|hcso|mandate)'] },
  { place: 'Connecticut', tax: ['meals\\s+tax'], fee: ['bottle\\s+deposit'] },
  {
    place: 'District of Columbia',
    fee: ['environmental\\s+surcharge', 'i-?82', 'restaurant\\s+recovery', 'supply\\s+increase', 'wellness\\s+(charge|fee|surcharge)'],
  },
  { place: 'Florida', fee: ['non-?\\s*cash\\s+adj(ustment)?'] },
  { place: 'Hawaii', tax: ['ge\\s+tax', 'general\\s+excise', 'g\\.e\\.t', 'get(?=\\s*\\(?\\d{1,2}(\\.\\d+)?\\s*%|\\s*$)'], fee: ['hi-?\\s*5'] },
  { place: 'Illinois: Chicago', tax: ['bag\\s+tax', 'liquor\\s+tax', 'restaurant\\s+tax'] },
  { place: 'Indiana', tax: ['food\\s+(and|&)\\s+bev(erage)?\\s+tax'] },
  { place: 'Iowa', fee: ['bottle\\s+deposit'] },
  { place: 'Kansas', tax: ['liquor\\s+drink'] },
  { place: 'Louisiana: New Orleans', tax: ['food\\s+(and|&)\\s+bev(erage)?\\s+tax'] },
  { place: 'Maine', tax: ['meals\\s+tax', 'prepared\\s+food\\s+tax'], fee: ['bottle\\s+deposit'] },
  { place: 'Massachusetts', tax: ['meals\\s+tax'], fee: ['bottle\\s+deposit'] },
  { place: 'Michigan', fee: ['bottle\\s+deposit'] },
  { place: 'Minnesota', tax: ['liquor\\s+gross\\s+receipts'] },
  { place: 'Minnesota: Minneapolis', tax: ['downtown\\s+(liquor|restaurant|food)\\s+tax'] },
  { place: 'Nevada: Las Vegas', fee: ['cnf', 'concession\\s+(and|&)\\s+franchise'] },
  { place: 'New Hampshire', tax: ['meals\\s+(and|&)\\s+(rooms|rentals)'] },
  { place: 'New Mexico', tax: ['gross\\s+receipts', 'grt'] },
  { place: 'New York', fee: ['bottle\\s+deposit'] },
  { place: 'New York: New York City', item: ['split\\s+meal', 'split\\s*-?\\s*plate'] },
  { place: 'North Carolina', tax: ['prepared\\s+meals'] },
  { place: 'Oregon', fee: ['bottle\\s+deposit'] },
  { place: 'Oregon: Ashland', tax: ['food\\s+(and|&)\\s+bev(erage)?\\s+tax'] },
  { place: 'Pennsylvania: Philadelphia', tax: ['liquor\\s+(sales\\s+)?tax'] },
  { place: 'Rhode Island', tax: ['meals\\s+(and|&)\\s+bev(erage)?\\s+tax'] },
  { place: 'South Carolina', tax: ['hospitality\\s+tax', 'liquor[\\s-]+by[\\s-]+the[\\s-]+drink\\s+tax'] },
  { place: 'Tennessee', tax: ['lbd', 'liquor[\\s-]+by[\\s-]+the[\\s-]+drink\\s+tax'] },
  { place: 'Tennessee: Nashville', fee: ['cbid'] },
  { place: 'Texas', tax: ['mb\\s+sales\\s+tax', 'mixed\\s+bev(erage)?\\s+(sales\\s+)?tax'] },
  { place: 'Utah', tax: ['restaurant\\s+tax'] },
  { place: 'Vermont', tax: ['meals\\s+(and|&)\\s+rooms'], fee: ['bottle\\s+deposit'] },
  { place: 'Virginia', tax: ['meals\\s+tax'] },
];

export const ANYWHERE = {
  fee: [
    'back[\\s-]+of[\\s-]+house',
    'benefits?\\s+(fee|surcharge)',
    'btl\\.?\\s+dep',
    'can\\s+deposit',
    'container\\s+(deposit|fee)',
    'convenience',
    'dine[\\s-]*in\\s+(charge|fee)',
    'employee\\s+benefits?',
    'fair\\s+wage',
    'fees?',
    'health(care)?\\s+(charge|insurance|surcharge|mandate|ordinance)',
    'hospitality(?=\\s*(charge|fee|included|surcharge|\\(|\\d|$))',
    'kitchen\\s+(appreciation|staff|team)',
    'labor\\s+(charge|fee|surcharge)',
    'living\\s+wage',
    'mandate',
    'operations?\\s+(charge|fee)',
    'processing',
    'recovery\\s+(charge|fee)',
    'surcharge',
    'team\\s+member\\s+benefit',
    'wage\\s+benefit',
    'wellness(?=\\s*(benefits?|charge|fee|surcharge|\\(|\\d|$))',
  ],
  item: ['cake[\\s-]*(cutting|plating|fee)', 'corkage', 'plate\\s+(sharing|split)', 'sharing\\s+(charge|fee)'],
};

const build = (kind) => {
  const parts = [...PLACES.flatMap((p) => p[kind] || []), ...(ANYWHERE[kind] || [])];
  return new RegExp(`\\b(?:${[...new Set(parts)].join('|')})\\b`);
};

export const CHARGE_RE = { tax: build('tax'), fee: build('fee'), item: build('item') };
