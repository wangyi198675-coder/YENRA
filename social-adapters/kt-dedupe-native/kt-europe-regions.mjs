// Geographical scope used only for conflict checking, never for KT verdicts.
// UN M49 Europe subregions + XK, and common cross-regional European contacts
// (Cyprus, Armenia, Azerbaijan, Georgia, Turkiye, Kazakhstan).
// The numbering plan itself comes ONLY from libphonenumber-js metadata.
export const europeGroups=Object.freeze({
 north:'AX DK EE FO FI GG IS IE IM JE LV LT NO SJ SE GB',
 south:'AL AD BA HR GI GR VA IT MT ME MK PT SM RS SI ES',
 west:'AT BE FR DE LI LU MC NL CH',
 east:'BY BG CZ HU PL MD RO RU SK UA',
 extended:'XK CY AM AZ GE TR KZ',
});
export const europeanCountryCodes=Object.freeze([
 ...new Set(Object.values(europeGroups).flatMap(s=>s.split(' ')))
]);
export const europeanCountrySet=new Set(europeanCountryCodes);
