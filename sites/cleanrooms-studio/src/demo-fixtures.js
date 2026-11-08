/* Deterministic work data for the guided planning examples. */
(() => {
  'use strict';

  const scenarios = [
    {id:'overlap',title:'Overlap på tværs af arbejdssteder',description:'Emma har mandag den 26. oktober en ekstra vagt kl. 11–15 på Kontor Nord oven i vagten kl. 06–13 i Klinikken.',expected:'Plantjek viser ét overlap på to timer. Ugen kan udgives, når overlappet er løst.'},
    {id:'leave',title:'Godkendt fravær',description:'Prøv at tildele Lea den ledige vagt i Klinikken onsdag den 28. oktober kl. 07–14.',expected:'Tildelingen blokeres, fordi Lea har godkendt ferie den dag.'},
    {id:'request',title:'Et friønske, der afventer svar',description:'Prøv Emma til den ledige vagt i Klinikken tirsdag den 3. november kl. 14–16.',expected:'Emma er ledig på tidspunktet. Hendes friønske vises som information, og ugen går fra 35 til 37 timer.'},
    {id:'hours',title:'Timer i forhold til aftalen',description:'Prøv Jonas til den ledige vagt i Klinikken onsdag den 28. oktober kl. 07–14.',expected:'Jonas er ledig. Hans uge går fra 16 til 23 timer, hvilket vises som information uden at blokere tildelingen.'},
    {id:'series',title:'Et fast rul gennem seks måneder',description:'Jonas arbejder tirsdag og torsdag kl. 07–15 frem til april. Åbn en vagt for at vælge én forekomst, kommende vagter eller hele serien.',expected:'Serien indeholder 52 vagter. En ændring af én forekomst bevarer resten af serien.'},
    {id:'bulk',title:'Flere vagter i én handling',description:'Marker flere vagter, og prøv at rette tider, flytte datoer eller oprette selvstændige kopier.',expected:'Hele udvalget kontrolleres og gemmes samlet. Fortryd gendanner hele handlingen.'},
    {id:'coverage',title:'Bemandingsbehov og afløsere',description:'Onsdag mangler Klinikken én medarbejder kl. 07–13. Åbn bemandingshullet, og vælg en medarbejder til den eksisterende ledige vagt.',expected:'Dækningen opdateres med det samme. Godkendt fravær og overlap blokerer tildeling; ugens timer vises før og efter.'}
  ];

  function create(scenario = 'overview') {
    if (scenario !== 'overview' && !scenarios.some(item=>item.id===scenario)) throw new TypeError('Vælg et gyldigt demoeksempel.');
    const edits = {};
    if (scenario === 'overview' || scenario === 'overlap') edits['demo-overlap-emma'] = {id:'demo-overlap-emma',person:'p1',date:'2026-10-26',site:0,start:'11:00',end:'15:00',note:'Eksempel: overlap på tværs af arbejdssteder'};
    if (scenario === 'overview' || scenario === 'request') edits['demo-request-shift'] = {id:'demo-request-shift',person:'',date:'2026-11-03',site:1,start:'14:00',end:'16:00',note:'Friønske afventer svar'};
    return {
      edits,
      deleted:[],
      series:[{id:'jonas-plan',person:'p0',site:0,startDate:'2026-10-26',endDate:'2027-04-26',weekdays:[1,3],start:'07:00',end:'15:00',note:''}],
      weekPlans:{},requests:{}
    };
  }

  const api = Object.freeze({create,get scenarios(){ return scenarios.map(scenario=>({...scenario})); }});
  globalThis.CleanRoomsDemo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
