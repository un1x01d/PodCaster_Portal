/**
 * A basic keyword-based analyzer to simulate AI responses when the OpenAI API is unavailable.
 * This is intended for development and testing purposes.
 * 
 * Enhanced with knowledge from the semantic dictionary and financial ratios.
 */

export function callMockAI({ message, headers = [], sampleRows = [], semanticBrain = null }) {
  const msg = String(message || "").toLowerCase();
  const plan = {
    answer: "I am currently in mock mode because the AI service is unavailable. I'm using my local semantic brain to understand your request.",
    operation: "none",
    target_column: null,
    group_by: null,
    filters: [],
    chart: null,
  };

  // Try to find a numeric column for summing/averaging
  const numericCols = headers.filter(h => {
    const val = sampleRows[0]?.[h];
    return typeof val === 'number' || (!isNaN(parseFloat(val)) && isFinite(val));
  });

  // Try to find a text column for grouping
  const textCols = headers.filter(h => !numericCols.includes(h));

  // Utilize Semantic Brain for better column matching
  let semanticTarget = null;
  if (semanticBrain && semanticBrain.buckets) {
    for (const bucket of semanticBrain.buckets) {
        // If message contains the bucket key or any of its synonyms
        if (msg.includes(bucket.key) || bucket.synonyms.some(s => msg.includes(s))) {
            // Find a column that matches the bucket key or synonyms
            const matchingCol = headers.find(h => {
                const hLower = h.toLowerCase();
                return hLower.includes(bucket.key) || bucket.synonyms.some(s => hLower.includes(s));
            });
            if (matchingCol) {
                semanticTarget = matchingCol;
                break;
            }
        }
    }
  }

  // Detect Operation
  if (msg.includes("sum") || msg.includes("total")) {
    const target = semanticTarget || numericCols.find(h => msg.includes(h.toLowerCase())) || numericCols[0];
    if (target) {
      plan.operation = "sum";
      plan.target_column = target;
      plan.answer = `Calculating the total for ${target} based on your request.`;
    }
  } else if (msg.includes("average") || msg.includes("avg") || msg.includes("mean")) {
    const target = semanticTarget || numericCols.find(h => msg.includes(h.toLowerCase())) || numericCols[0];
    if (target) {
      plan.operation = "avg";
      plan.target_column = target;
      plan.answer = `Calculating the average for ${target} based on your request.`;
    }
  } else if (msg.includes("top") || msg.includes("highest") || msg.includes("best")) {
    const target = semanticTarget || numericCols.find(h => msg.includes(h.toLowerCase())) || numericCols[0];
    const group = textCols.find(h => msg.includes(h.toLowerCase())) || textCols[0];
    if (target && group) {
      plan.operation = "top_n";
      plan.target_column = target;
      plan.group_by = group;
      plan.answer = `Showing the top results for ${target} grouped by ${group}.`;
    }
  } else if (msg.includes("show") || msg.includes("filter") || msg.includes("find")) {
    plan.operation = "filter";
    plan.answer = "Filtering the data based on your request.";
  }

  // If no operation detected but we found a semantic target, default to sum
  if (plan.operation === "none" && semanticTarget) {
      plan.operation = "sum";
      plan.target_column = semanticTarget;
      plan.answer = `Calculating ${semanticTarget} based on your request.`;
  }

  return {
    plan,
    usage: {
      provider: "mock",
      model: "enhanced-mock-analyzer-v1",
      promptTokens: 0,
      completionTokens: 0,
      estimatedCostUsd: 0,
    }
  };
}
