// Namuna savollar banki — IELTS Speaking uslubida. Admin paneldan tahrirlash mumkin.
// part 1 — qisqa savollar, part 2 — kartochka (bullets), part 3 — muhokama savollari.
const cue = (text, bullets) => ({ part: 2, text, bullets: bullets.join('\n') });

module.exports = [
  {
    title: 'Hometown',
    items: [
      { part: 1, text: 'Where is your hometown and what is it like?' },
      { part: 1, text: 'What do you like most about the place where you live?' },
      { part: 1, text: 'Has your hometown changed much in recent years?' },
      { part: 1, text: 'Would you like to live somewhere else in the future? Why?' },
      { part: 1, text: 'Is your hometown a good place for young people? Why or why not?' },
      cue('Describe a place in your hometown that you often take visitors to.', [
        'where it is', 'what people can do there', 'why visitors like it',
        'and explain how you feel when you go there',
      ]),
      { part: 3, text: 'How do cities in your country change as they grow?' },
      { part: 3, text: 'What are the advantages and disadvantages of living in a big city?' },
      { part: 3, text: 'Should governments spend money on making cities more beautiful, or on other things?' },
      { part: 3, text: 'Do you think people will move to smaller towns in the future? Why?' },
    ],
  },
  {
    title: 'Work and Study',
    items: [
      { part: 1, text: 'Do you work or are you a student at the moment?' },
      { part: 1, text: 'What subject or job did you choose, and why?' },
      { part: 1, text: 'What is the most difficult part of your work or studies?' },
      { part: 1, text: 'Do you prefer working alone or with other people? Why?' },
      { part: 1, text: 'What would you like to be doing in five years?' },
      cue('Describe a skill you learned that has been useful to you.', [
        'what the skill is', 'how and when you learned it', 'how difficult it was',
        'and explain why it has been useful',
      ]),
      { part: 3, text: 'Which skills do young people in your country need most today?' },
      { part: 3, text: 'Do you think schools prepare students well for real work? Why?' },
      { part: 3, text: 'How has technology changed the way people work?' },
      { part: 3, text: 'Is it better to have one career for life, or to change jobs often?' },
    ],
  },
  {
    title: 'Free time and hobbies',
    items: [
      { part: 1, text: 'What do you usually do in your free time?' },
      { part: 1, text: 'Do you prefer spending free time indoors or outdoors?' },
      { part: 1, text: 'Have your hobbies changed since you were a child?' },
      { part: 1, text: 'Do you have enough free time during the week? Why or why not?' },
      { part: 1, text: 'What new hobby would you like to try?' },
      cue('Describe a hobby you would like to take up in the future.', [
        'what the hobby is', 'why it interests you', 'what you would need to start',
        'and explain how it might change your daily life',
      ]),
      { part: 3, text: 'Why do some people find it hard to relax in their free time?' },
      { part: 3, text: 'Do people in your country have more or less free time than in the past?' },
      { part: 3, text: 'Should schools give students more time for hobbies? Why?' },
      { part: 3, text: 'How do hobbies help people in their work or studies?' },
    ],
  },
  {
    title: 'Technology and the internet',
    items: [
      { part: 1, text: 'How often do you use the internet during the day?' },
      { part: 1, text: 'Which app or website do you use most, and why?' },
      { part: 1, text: 'Do you think you spend too much time on your phone?' },
      { part: 1, text: 'How do you usually learn to use a new device or app?' },
      { part: 1, text: 'Did technology help you learn English? In what way?' },
      cue('Describe a piece of technology that has made your life easier.', [
        'what it is', 'when you started using it', 'how often you use it',
        'and explain how your life would be different without it',
      ]),
      { part: 3, text: 'What problems can social media cause for young people?' },
      { part: 3, text: 'Will artificial intelligence replace some jobs in your country? Which ones?' },
      { part: 3, text: 'Should parents control how much time children spend online?' },
      { part: 3, text: 'How can technology improve education in the future?' },
    ],
  },
  {
    title: 'Food and cooking',
    items: [
      { part: 1, text: 'What kind of food do you usually eat at home?' },
      { part: 1, text: 'Do you enjoy cooking? Why or why not?' },
      { part: 1, text: 'What traditional dish from your country would you recommend to a visitor?' },
      { part: 1, text: 'Do you prefer eating at home or in restaurants?' },
      { part: 1, text: 'Have your eating habits changed in the last few years?' },
      cue('Describe a meal you remember well.', [
        'what the meal was', 'where and with whom you ate it', 'what made it special',
        'and explain why you still remember it',
      ]),
      { part: 3, text: 'Why do you think fast food is popular among young people?' },
      { part: 3, text: 'How have eating habits in your country changed over the last twenty years?' },
      { part: 3, text: 'Should governments do more to encourage healthy eating? How?' },
      { part: 3, text: 'Do traditional dishes still matter in modern life? Why?' },
    ],
  },
  {
    title: 'Travel and holidays',
    items: [
      { part: 1, text: 'Do you like travelling? Where was your last trip?' },
      { part: 1, text: 'How do you usually plan a holiday?' },
      { part: 1, text: 'Do you prefer travelling alone or with other people?' },
      { part: 1, text: 'What is the best way to travel around your country?' },
      { part: 1, text: 'Which country would you most like to visit? Why?' },
      cue('Describe a journey that did not go as planned.', [
        'where you were going', 'who you were with', 'what went wrong',
        'and explain what you learned from it',
      ]),
      { part: 3, text: 'Why do so many people want to travel abroad these days?' },
      { part: 3, text: 'What benefits does tourism bring to a country, and what problems can it cause?' },
      { part: 3, text: 'Is it better to visit one place for a long time or many places quickly?' },
      { part: 3, text: 'How might travelling change in the next twenty years?' },
    ],
  },
  {
    title: 'Family and friends',
    items: [
      { part: 1, text: 'Do you spend more time with your family or your friends?' },
      { part: 1, text: 'What do you usually do together with your family?' },
      { part: 1, text: 'How do you keep in touch with friends who live far away?' },
      { part: 1, text: 'Is it easy to make new friends where you live?' },
      { part: 1, text: 'Who in your family are you most similar to?' },
      cue('Describe a person who has had a strong influence on you.', [
        'who the person is', 'how you know them', 'what they are like',
        'and explain how they have influenced you',
      ]),
      { part: 3, text: 'How have family roles changed in your country in recent years?' },
      { part: 3, text: 'Is it important for children to spend time with grandparents? Why?' },
      { part: 3, text: 'Do online friendships work as well as face-to-face ones?' },
      { part: 3, text: 'What makes a friendship last for many years?' },
    ],
  },
  {
    title: 'Learning English',
    items: [
      { part: 1, text: 'How long have you been learning English?' },
      { part: 1, text: 'Which part of English do you find the most difficult?' },
      { part: 1, text: 'How do you practise speaking outside the classroom?' },
      { part: 1, text: 'Do you watch films or listen to music in English?' },
      { part: 1, text: 'How will English help you in the future?' },
      cue('Describe a time when you had to speak English outside the classroom.', [
        'where you were', 'who you spoke to', 'what you talked about',
        'and explain how you felt during the conversation',
      ]),
      { part: 3, text: 'At what age should children start learning a foreign language? Why?' },
      { part: 3, text: 'Why do some learners speak fluently but make many mistakes?' },
      { part: 3, text: 'Is it necessary to live abroad to speak a language well?' },
      { part: 3, text: 'How could language teaching in schools be improved?' },
    ],
  },
];
