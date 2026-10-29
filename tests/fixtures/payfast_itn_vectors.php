<?php
// Generates ITN signature vectors with Payfast's reference code (docs Step 4.3),
// verbatim except that $_POST comes from parse_str() (PHP's own POST parser).
function pfParamString($pfData) {
  foreach ($pfData as $key => $val) { $pfData[$key] = stripslashes($val); }
  $pfParamString = '';
  foreach ($pfData as $key => $val) {
    if ($key !== 'signature') { $pfParamString .= $key . '=' . urlencode($val) . '&'; } else { break; }
  }
  return substr($pfParamString, 0, -1);
}
$cases = [
  ['name' => 'typical COMPLETE with empty optional fields', 'pass' => 'fake-passphrase-1',
   'fields' => [['m_payment_id','CBW-0A1B2C3D4E'],['pf_payment_id','1089250'],['payment_status','COMPLETE'],['item_name','Carmen order CBW-0A1B2C3D4E'],['item_description','The First Book, The Second Book'],['amount_gross','448.00'],['amount_fee','-10.30'],['amount_net','437.70'],['custom_str1',''],['custom_str2',''],['custom_str3',''],['custom_str4',''],['custom_str5',''],['custom_int1',''],['custom_int2',''],['custom_int3',''],['custom_int4',''],['custom_int5',''],['name_first','Thandi'],['name_last','van der Merwe'],['email_address','buyer+test@example.com'],['merchant_id','10000001']]],
  ['name' => 'special characters, emoji, NBSP and apostrophes', 'pass' => "fake pass & = phrase",
   'fields' => [['m_payment_id','CBW-ZZZZZZZZZZ'],['pf_payment_id','42'],['payment_status','COMPLETE'],['item_name',"Carmen's \"Best\" Course & Workbook = 100% 😀"],['item_description',"Line one\nLine two\u{00A0}nbsp ~*()!"],['amount_gross','1997.00'],['name_first','Zoë'],['name_last','O\'Brien-Ndlovu'],['email_address','a@example.com'],['merchant_id','10000001']]],
  ['name' => 'backslashes are stripped as stripslashes() does', 'pass' => 'fake-passphrase-3',
   'fields' => [['m_payment_id','CBW-1111111111'],['pf_payment_id','7'],['payment_status','COMPLETE'],['item_name','C:\\path\\to \\\\ double'],['amount_gross','5.00'],['merchant_id','10000001']]],
  ['name' => 'fields after the signature are not signed', 'pass' => 'fake-passphrase-4',
   'fields' => [['m_payment_id','CBW-2222222222'],['pf_payment_id','8'],['payment_status','CANCELLED'],['amount_gross','5.00'],['merchant_id','10000001']], 'after' => [['extra_field','not signed']]],
];
$out = [];
foreach ($cases as $c) {
  $pairs = $c['fields'];
  $tmp = [];
  foreach ($pairs as [$k, $v]) $tmp[$k] = $v;
  $sig = md5(pfParamString($tmp) . '&passphrase=' . urlencode($c['pass']));
  $all = $pairs; $all[] = ['signature', $sig]; foreach ($c['after'] ?? [] as $p) $all[] = $p;
  $body = implode('&', array_map(fn($p) => urlencode($p[0]) . '=' . urlencode($p[1]), $all));
  // Re-derive through PHP's real POST parser to prove the body round-trips.
  parse_str($body, $post);
  $check = md5(pfParamString($post) . '&passphrase=' . urlencode($c['pass']));
  if ($check !== $sig || $post['signature'] !== $sig) { fwrite(STDERR, "round-trip mismatch: {$c['name']}\n"); exit(1); }
  $out[] = ['name' => $c['name'], 'passphrase' => $c['pass'], 'body' => $body, 'paramString' => pfParamString($post), 'signature' => $sig];
}
echo json_encode(['source' => 'Payfast developer docs, Step 4.3 (pfValidSignature + stripslashes/urlencode loop), run on PHP ' . PHP_VERSION, 'vectors' => $out], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), "\n";
