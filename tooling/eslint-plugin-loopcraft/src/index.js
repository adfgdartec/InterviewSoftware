import { noAffectInference } from './no-affect-inference.js';

const plugin = {
  meta: { name: 'eslint-plugin-loopcraft', version: '0.0.0' },
  rules: { 'no-affect-inference': noAffectInference },
};

export default plugin;
export { noAffectInference };
