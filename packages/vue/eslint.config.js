import config from '@fluxgantt/eslint-config';

const base = Array.isArray(config) ? config : [config];

export default [...base];
