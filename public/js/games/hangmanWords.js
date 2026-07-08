// Word bank for co-op Hangman. Every word is lowercase a-z, 5 or 6 letters,
// and unique within its category (verified programmatically).
export const CATEGORIES = {
  'Car brands': [
    'honda', 'mazda', 'lexus', 'dodge', 'buick', 'tesla',
    'volvo', 'acura', 'skoda', 'lotus', 'isuzu',
    'toyota', 'nissan', 'suzuki', 'jaguar', 'holden',
  ],
  'Food': [
    'pizza', 'pasta', 'bread', 'apple', 'lemon', 'mango',
    'salad', 'honey', 'steak', 'sushi', 'bacon', 'olive',
    'cheese', 'tomato', 'banana', 'carrot', 'pepper',
  ],
  'Animals': [
    'tiger', 'horse', 'zebra', 'sheep', 'mouse', 'koala',
    'panda', 'otter', 'moose', 'snake', 'whale', 'camel',
    'rabbit', 'monkey', 'donkey', 'ferret', 'beaver',
  ],
  'Verbs': [
    'write', 'dance', 'sleep', 'laugh', 'climb', 'drink',
    'throw', 'build', 'teach', 'shout', 'catch', 'paint',
    'gather', 'listen', 'decide', 'travel', 'follow',
  ],
  'Sports': [
    'rugby', 'darts', 'bowls', 'chess',
    'hockey', 'boxing', 'karate', 'tennis', 'soccer', 'squash',
    'skiing', 'diving', 'rowing', 'discus',
  ],
  'Countries': [
    'spain', 'italy', 'china', 'japan', 'india', 'egypt',
    'chile', 'ghana', 'kenya', 'qatar', 'nepal', 'syria',
    'france', 'brazil', 'canada', 'mexico', 'norway', 'sweden', 'poland',
  ],
};
