import OpenAI from 'openai';

const defaultChatChatCompletion = {
  model: 'gpt-4',
  temperature: 0.8,
};

export async function createChatCompletion({
  messages,
  options,
}: {
  messages: OpenAI.Chat.Completions.CreateChatCompletionRequestMessage[];
  options?: { temperature?: number; model: string };
}): Promise<OpenAI.Chat.Completions.ChatCompletion.Choice> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const response = await openai.chat.completions.create({
      messages: messages,
      ...defaultChatChatCompletion,
      ...options,
    });

    console.log('OpenAI response', response.choices[0].message)
    return response.choices[0];
  } catch (error) {
    return handleError({
      error,
      messages,
      retryFunction: createChatCompletion.bind(this),
    });
  }
}

let requestTentative = 0;

function handleError({ error, messages, retryFunction }) {
  console.error(error?.response?.data?.error?.message || error.message, {
    error: error.message,
    errorObj: error?.response?.data?.error?.message,
  });

  const errorStatus = error?.response?.status;

  if (errorStatus === 409) {
    if (requestTentative > 3) {
      throw new Error('Too many requests to OpenAI');
    }

    console.warn('Got 409 error, retrying...');
    requestTentative++;
    return retryFunction({
      messages,
    }).then((res) => {
      requestTentative = 0;
      return res;
    });
  }

  if (errorStatus >= 400) {
    throw new Error('OpenAI denied access to our AI source');
  }

  throw new Error('OpenAI API error');
}
