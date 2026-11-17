// Authoritative rules and document verification belong to the repository.
// This result is a candidate, never approval, availability or assignment.
export function decideTrustedVehicle(parameters, rule, decisions, exception = null) {
  const known = new Set((rule?.conditions ?? []).map(c => c.id));
  const results = new Map();
  for (const item of decisions) {
    if (!known.has(item.conditionId) || results.has(item.conditionId) ||
        !['satisfied', 'unmet'].includes(item.result)) return { error: 'invalid_conditions' };
    results.set(item.conditionId, item.result);
  }
  const waived = new Set(exception?.waivedConditionIds ?? []);
  if (exception && (!rule || rule.make !== parameters.make ||
      exception.basisRuleVersion !== rule.version || waived.size !== exception.waivedConditionIds.length ||
      [...waived].some(id => !known.has(id) || results.get(id) !== 'unmet'))) return { error: 'invalid_exception' };
  if (rule && (rule.make !== parameters.make || (!exception && rule.model !== parameters.model))) return { error: 'invalid_rule' };
  const result = (outcome, reasonCodes, vehicleClass = null) => ({ outcome, vehicleClass, ruleVersion: rule?.version ?? null, reasonCodes });
  if (parameters.powertrain === 'battery_electric') return result('excluded', ['battery_electric']);
  if (!rule) return result('manual_review', ['model_not_found']);
  // Hard policy applies even to exceptions and independent of rule authoring.
  const businessBody = parameters.make === 'Li Auto' && ['L7', 'L9'].includes(parameters.model) ? 'crossover' : 'sedan';
  if ((rule.vehicleClass === 'comfort' && !['sedan', 'crossover'].includes(parameters.bodyType)) ||
      (rule.vehicleClass === 'business' && parameters.bodyType !== businessBody) ||
      (rule.allowedBodyTypes !== null && !rule.allowedBodyTypes.includes(parameters.bodyType))) return result('excluded', ['body_type_not_allowed']);
  const reasons = [];
  if (parameters.modelYear < rule.minYear && exception?.yearBelowMinimum !== true) reasons.push('year_below_minimum');
  if ([...known].some(id => !results.has(id))) reasons.push('rule_conditions_unverified');
  if ([...results].some(([id, state]) => state === 'unmet' && !waived.has(id))) reasons.push('rule_conditions_unmet');
  return reasons.length ? result('manual_review', reasons) : result('candidate', [], rule.vehicleClass);
}
