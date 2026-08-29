import {
  findBannedTokensInFieldName,
  findBannedTokensInText,
} from '@loopcraft/core/banned-tokens';

/**
 * Fails the build when a schema field name, prompt, or user-facing string infers emotion,
 * sentiment, engagement, confidence, enthusiasm, mood, or personality from a person.
 *
 * Guardrail 1 / spec §5.1 / acceptance criterion 4. The vocabulary and the statistical
 * exemptions live in @loopcraft/core so the ESLint rule, the runtime string scanner and the
 * Python worker test all read the same list.
 */

const MESSAGES = {
  bannedField:
    "'{{name}}' infers an internal state ('{{token}}'). Spec §5.1 forbids emotion inference; " +
    'derive the signal from transcript text or audio timing and name it after the measurement.',
  bannedString:
    "This string reports '{{token}}', an inferred internal state. Spec §5.1 forbids emotion " +
    'inference in user-facing copy and in grader prompts.',
};

/** Property keys, TS members, and enum members all resolve to a plain name here. */
function keyName(node) {
  if (node === null || node === undefined) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  return null;
}

export const noAffectInference = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow emotion, sentiment, engagement, confidence, enthusiasm, mood and personality ' +
        'inference in field names, prompts and user-facing strings.',
    },
    schema: [
      {
        type: 'object',
        properties: { checkStrings: { type: 'boolean' } },
        additionalProperties: false,
      },
    ],
    messages: MESSAGES,
  },

  create(context) {
    const options = context.options[0] ?? {};
    const checkStrings = options.checkStrings !== false;

    function reportField(node, name) {
      const hits = findBannedTokensInFieldName(name);
      if (hits.length === 0) return;
      context.report({
        node,
        messageId: 'bannedField',
        data: { name, token: hits[0].token },
      });
    }

    return {
      Property(node) {
        const name = keyName(node.key);
        if (name !== null) reportField(node.key, name);
      },
      PropertyDefinition(node) {
        const name = keyName(node.key);
        if (name !== null) reportField(node.key, name);
      },
      TSPropertySignature(node) {
        const name = keyName(node.key);
        if (name !== null) reportField(node.key, name);
      },
      TSEnumMember(node) {
        const name = keyName(node.id);
        if (name !== null) reportField(node.id, name);
      },
      Literal(node) {
        if (!checkStrings) return;
        if (typeof node.value !== 'string') return;
        // A property key that is a string literal is already handled by Property.
        if (node.parent?.type === 'Property' && node.parent.key === node) return;
        const hits = findBannedTokensInText(node.value);
        if (hits.length === 0) return;
        context.report({ node, messageId: 'bannedString', data: { token: hits[0].token } });
      },
      TemplateElement(node) {
        if (!checkStrings) return;
        const raw = node.value.cooked ?? node.value.raw;
        const hits = findBannedTokensInText(raw);
        if (hits.length === 0) return;
        context.report({ node, messageId: 'bannedString', data: { token: hits[0].token } });
      },
    };
  },
};
