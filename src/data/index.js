// src/data/index.js
import { EptList } from './Erogames-pt.js';
import { EenList } from './Erogames-en.js';
import { EsList } from './Erogame-es.js';

export const GAMES_BY_LANG = {
    pt: EptList,
    en: EenList,
    es: EsList,
};