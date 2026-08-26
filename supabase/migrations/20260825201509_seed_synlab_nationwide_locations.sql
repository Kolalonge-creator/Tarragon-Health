-- Seeds Synlab Nigeria's real branch network into lab_provider_locations,
-- sourced from the official SYNLAB Nigeria locations page
-- (https://www.synlab.com.ng/locations/), fetched 2026-08-25. 39 branches
-- across 15 states. Phone numbers normalized to E.164 (+234...) to satisfy
-- lab_provider_locations_contact_phone_e164.
--
-- Latitude/longitude deliberately left NULL — no Google Maps Geocoding API
-- key is configured yet (founder-blocked, see NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
-- in .env.example), so these rows won't render a pin on /coverage until
-- geocoded, either in bulk once a real key exists or one at a time via the
-- admin "Geocode" button. public_partner_locations() already filters out any
-- row with a null latitude/longitude, so this is inert until then, not
-- broken.
--
-- lab_provider_id resolved via subquery, never a hardcoded UUID literal, per
-- the standing "no hardcoded generated IDs in data migrations" rule.
insert into public.lab_provider_locations (lab_provider_id, name, state, address, contact_phone)
select (select id from public.lab_providers where name = 'Synlab Nigeria'), v.name, v.state, v.address, v.contact_phone
from (values
  ('Abeokuta', 'Ogun', 'Bayus Complex, Olabisi Onabanjo Way, Idi-Aba (beside Abeokuta Grammar School), Abeokuta', '+2347000796522'),
  ('Ago Palace Way Lab', 'Lagos', '154 Ago Palace Way, Okota, Lagos', '+2347074760143'),
  ('Agungi, Lekki', 'Lagos', '7 Agungi Ajiran Road, Lekki, Lagos', '+2347074760143'),
  ('Ajah', 'Lagos', 'SYNLAB Nigeria MCC Ajah, Ajah, Lagos', '+2347000796522'),
  ('Asokoro', 'Abuja', '18 T.Y. Danjuma Street, beside Embassy of Namibia, Asokoro, Abuja', '+2347000796522'),
  ('Benin', 'Edo', 'Doctors'' House, beside University of Benin Teaching Hospital (UBTH), Benin City', '+2347000796522'),
  ('Benue State University Teaching Hospital', 'Benue', '3 Makurdi-Gboko Road, Makurdi', '+2347000796522'),
  ('DELSUTH', 'Delta', 'Delta State University Teaching Hospital, Otefe Road, beside Zenith Bank, Oghara', '+2347000796522'),
  ('Ebonyi', 'Ebonyi', 'David Umahi Federal University Teaching Hospital, Uburu-Okposi Road, Uburu', '+2347000796522'),
  ('Enugu', 'Enugu', '26A Forest Crescent, by Parklane Teaching Hospital, GRA, Enugu', '+2347000796522'),
  ('Festac', 'Lagos', 'Canary World Plaza (beside UBA Bank), 23 Road, Festac Town, Lagos', '+2347000796522'),
  ('Gwagwalada', 'Abuja', 'House 249, Community Bank Road, Phase 2, Gwagwalada, Abuja', '+2347000796522'),
  ('Gwarinpa', 'Abuja', '10, 1st Avenue, Gwarinpa Estate, Abuja', '+2347000796522'),
  ('Ibadan Lab', 'Oyo', '1 Aperin Street, Old Bodija, Ibadan', '+2347000796522'),
  ('Ife', 'Osun', 'RX-Oroki Pharmacy, Ilesa Road, Ile-Ife', '+2347000796522'),
  ('Ikeja BCP - I', 'Lagos', '66 Oduduwa Way, GRA, Ikeja, Lagos', '+2347000796522'),
  ('Ikeja Lab', 'Lagos', 'Aviation Plaza, Ikeja, opposite LASUTH, Lagos', '+2347000796522'),
  ('Ikoyi BCP', 'Lagos', 'Ikoyi Plaza, Awolowo Road, Ikoyi, Lagos', '+2348141306397'),
  ('Ilorin', 'Kwara', '23 Offa Road, opposite Ministry of Women Affairs (Registry), GRA, Ilorin', '+2347000796522'),
  ('Ilupeju BCP', 'Lagos', '4 Coker Road, Ilupeju, Lagos', '+2347000796522'),
  ('Kaduna', 'Kaduna', '9 Constitution Road, Kaduna', '+2347000796522'),
  ('Kubwa Lab', 'Abuja', '4025 Gado Nasko Road, Kubwa, Abuja', '+2349037775809'),
  ('Lekki EC', 'Lagos', 'Plot 81, Admiral Ayinla Street, off Freedom Way, Lekki Phase 1, Lagos', '+2347000796522'),
  ('Lekki Lab', 'Lagos', 'JOK Mall, 7 Bisola Durosinmi Etti Drive, Lekki, Lagos', '+2347000796522'),
  ('LUTH', 'Lagos', 'Ishaga Road, Surulere (LUTH premises, A&E spill-over ward), Lagos', '+2347000796522'),
  ('NSIA-LUTH Cancer Centre (NLCC)', 'Lagos', 'NSIA-LUTH Cancer Centre, Ishaga Road, Lagos', '+2347000796522'),
  ('Ogba BCP', 'Lagos', 'Update Mall, Ogunnusi Road, opposite Excellence Hotel, Ogba, Lagos', '+2348141306394'),
  ('Ogudu Lab', 'Lagos', '6 Imam Ligali Street, Ojota/Ogudu, Lagos', '+2347000796522'),
  ('Onitsha', 'Anambra', '144 Awka Road, Niger Bridge Layout, Onitsha', '+2349139577857'),
  ('Owerri', 'Imo', '20 Owerri-Orlu Road, Owerri', '+2347000796522'),
  ('Port Harcourt (Enaan Towers / UPTH Choba)', 'Rivers', 'Enaan Towers, opposite Uniport Main Gate, Port Harcourt', '+2347000796522'),
  ('Port Harcourt (GRA) BCP', 'Rivers', '41 Evo Road, GRA Phase II, Port Harcourt', '+2347000796522'),
  ('Port Harcourt Lab', 'Rivers', '209b Aba Road, Rumuola, Port Harcourt', '+2349062641476'),
  ('Sagamu', 'Ogun', '137A Akarigbo Road, Ijoku, Sagamu', '+2347000796522'),
  ('Sangotedo', 'Lagos', 'God''s Link International Limited, Lekki-Epe Expressway, Abijo, Lagos', '+2347074574994'),
  ('Surulere', 'Lagos', 'Kings Plaza, 80 Adeniran Ogunsanya Street, Surulere, Lagos', '+2347000796522'),
  ('Victoria Island', 'Lagos', '64 Adetokunbo Ademola Street, Victoria Island, Lagos', '+2347000796522'),
  ('Warri', 'Delta', 'No. 5 Akpofure Close, behind UBA, adjacent Urhobo College, Warri', '+2347000796522'),
  ('Wuse II', 'Abuja', '17 Aminu Kano Crescent, opposite Banex Plaza, Wuse II, Abuja', '+2347000796522')
) as v(name, state, address, contact_phone);

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.lab_provider_locations loc
  join public.lab_providers lp on lp.id = loc.lab_provider_id
  where lp.name = 'Synlab Nigeria';
  if v_count <> 39 then
    raise exception 'Expected 39 Synlab branch rows, got %', v_count;
  end if;
end $$;
