// Namuna testlar — admin paneldan tahrirlash yoki o'chirish mumkin.
// Har bir savol: [bo'lim, savol, [variantlar], to'g'ri variant indeksi]

const TESTS = [
  {
    title: 'A1 → A2 daraja o\'tish testi', from: 'A1', to: 'A2', duration: 30, pass: 70,
    description: 'Elementary darajaga o\'tish uchun. Grammatika, lug\'at va o\'qib tushunish.',
    questions: [
      ['Grammar', 'She ___ to school every day.', ['go', 'goes', 'going', 'is go'], 1],
      ['Grammar', 'There ___ two apples on the table.', ['is', 'am', 'are', 'be'], 2],
      ['Grammar', '___ you like coffee?', ['Do', 'Does', 'Are', 'Is'], 0],
      ['Grammar', 'I ___ at home yesterday.', ['am', 'was', 'were', 'be'], 1],
      ['Grammar', 'My brother is ___ than me.', ['tall', 'more tall', 'taller', 'tallest'], 2],
      ['Grammar', 'Look! The children ___ in the garden.', ['play', 'plays', 'are playing', 'played'], 2],
      ['Grammar', 'We didn\'t ___ the film last night.', ['watch', 'watched', 'watching', 'watches'], 0],
      ['Vocabulary', 'The opposite of "cheap" is ___.', ['small', 'expensive', 'easy', 'new'], 1],
      ['Vocabulary', 'My father\'s sister is my ___.', ['cousin', 'niece', 'aunt', 'grandmother'], 2],
      ['Vocabulary', 'I brush my teeth in the ___.', ['kitchen', 'bathroom', 'garage', 'garden'], 1],
      ['Vocabulary', 'We use an ___ to open a door.', ['key', 'pen', 'cup', 'bag'], 0],
      ['Vocabulary', 'It is very cold. Put on your ___.', ['sunglasses', 'shorts', 'coat', 'sandals'], 2],
      ['Reading', 'Read: "Tom gets up at 7. He has breakfast and goes to work by bus." — How does Tom go to work?', ['by car', 'on foot', 'by bus', 'by train'], 2],
      ['Reading', 'Read: "The shop opens at 9 a.m. and closes at 6 p.m. It is closed on Sundays." — When is the shop closed?', ['Saturday', 'Sunday', 'Monday', 'every evening at 5'], 1],
      ['Reading', 'Read: "Anna has a cat and two dogs. She doesn\'t have a bird." — How many pets does Anna have?', ['two', 'three', 'four', 'one'], 1],
    ],
  },
  {
    title: 'A2 → B1 daraja o\'tish testi', from: 'A2', to: 'B1', duration: 35, pass: 70,
    description: 'Pre-Intermediate darajaga o\'tish uchun.',
    questions: [
      ['Grammar', 'I ___ this film three times.', ['saw', 'have seen', 'see', 'am seeing'], 1],
      ['Grammar', 'While I ___ dinner, the phone rang.', ['cooked', 'was cooking', 'cook', 'have cooked'], 1],
      ['Grammar', 'If it rains tomorrow, we ___ at home.', ['stay', 'stayed', 'will stay', 'would stay'], 2],
      ['Grammar', 'You ___ wear a uniform. It\'s the school rule.', ['must', 'can', 'might', 'would'], 0],
      ['Grammar', 'This is the ___ book I have ever read.', ['more interesting', 'most interesting', 'interestinger', 'interesting'], 1],
      ['Grammar', 'I\'m ___ to visit my grandparents next weekend.', ['go', 'going', 'went', 'gone'], 1],
      ['Grammar', 'She has lived here ___ 2019.', ['for', 'since', 'from', 'ago'], 1],
      ['Grammar', 'There isn\'t ___ milk left in the fridge.', ['some', 'many', 'any', 'a'], 2],
      ['Vocabulary', 'Can you ___ me your pen, please?', ['borrow', 'lend', 'take', 'bring'], 1],
      ['Vocabulary', 'I\'m looking ___ my keys. Have you seen them?', ['at', 'after', 'for', 'up'], 2],
      ['Vocabulary', 'He was very ___ when he heard the good news.', ['exciting', 'excited', 'excite', 'excitement'], 1],
      ['Vocabulary', 'A person who designs buildings is an ___.', ['engineer', 'architect', 'accountant', 'electrician'], 1],
      ['Reading', 'Read: "Although the tickets were expensive, Sara decided to go to the concert because her favourite band was playing." — Why did Sara go?', ['The tickets were cheap', 'Her friend invited her', 'Her favourite band was playing', 'She won the tickets'], 2],
      ['Reading', 'Read: "The museum is free for students on Mondays. Other days, tickets cost $10." — A student visits on Friday. How much does she pay?', ['Nothing', '$5', '$10', '$20'], 2],
      ['Reading', 'Read: "Mark used to smoke, but he gave up two years ago." — What is true about Mark now?', ['He smokes', 'He doesn\'t smoke', 'He started smoking two years ago', 'He wants to smoke'], 1],
    ],
  },
  {
    title: 'B1 → B2 daraja o\'tish testi', from: 'B1', to: 'B2', duration: 40, pass: 70,
    description: 'Upper-Intermediate darajaga o\'tish uchun.',
    questions: [
      ['Grammar', 'If I ___ more time, I would learn another language.', ['have', 'had', 'will have', 'would have'], 1],
      ['Grammar', 'By the time we arrived, the film ___.', ['already started', 'has already started', 'had already started', 'was already starting'], 2],
      ['Grammar', 'The report ___ by the manager tomorrow.', ['will check', 'will be checked', 'is checking', 'checks'], 1],
      ['Grammar', 'She asked me where ___.', ['do I live', 'I lived', 'did I live', 'I am live'], 1],
      ['Grammar', 'I wish I ___ that email yesterday.', ["didn't send", "hadn't sent", "haven't sent", "wouldn't send"], 1],
      ['Grammar', 'He ___ be at home — his car is outside.', ['must', 'can\'t', 'shouldn\'t', 'needn\'t'], 0],
      ['Grammar', 'I\'m not used to ___ up so early.', ['get', 'got', 'getting', 'be getting'], 2],
      ['Grammar', 'The woman ___ car was stolen called the police.', ['who', 'which', 'whose', 'whom'], 2],
      ['Vocabulary', 'The meeting was ___ because the manager was ill.', ['called off', 'called up', 'called in', 'called back'], 0],
      ['Vocabulary', 'She made a ___ effort to finish the project on time.', ['considerable', 'considerate', 'considering', 'consider'], 0],
      ['Vocabulary', 'We need to ___ a decision by Friday.', ['do', 'make', 'take on', 'have'], 1],
      ['Vocabulary', 'The company\'s profits have increased ___ over the past year.', ['significance', 'significant', 'significantly', 'signify'], 2],
      ['Reading', 'Read: "Despite widespread concerns, the new policy has so far had little effect on local businesses." — What does the writer suggest?', ['The policy harmed businesses badly', 'People expected problems that have not really happened', 'Nobody was worried about the policy', 'The policy was cancelled'], 1],
      ['Reading', 'Read: "Remote work offers flexibility, yet many employees report feeling isolated from their colleagues." — What is the main disadvantage mentioned?', ['Lower salaries', 'Loneliness', 'Longer working hours', 'Poor internet'], 1],
      ['Reading', 'Read: "Had the team trained harder, they might have won the final." — What happened?', ['The team won the final', 'The team trained hard and lost', 'The team lost and didn\'t train enough', 'The final was cancelled'], 2],
    ],
  },
];

module.exports = async function seed(client) {
  for (const t of TESTS) {
    const { rows } = await client.query(
      'INSERT INTO tests (title, level_from, level_to, description, duration_min, pass_percent) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [t.title, t.from, t.to, t.description, t.duration, t.pass]);
    for (const [i, [section, text, opts, correct]] of t.questions.entries()) {
      await client.query(
        'INSERT INTO questions (test_id, section, text, options, correct, points, position) VALUES ($1,$2,$3,$4,$5,1,$6)',
        [rows[0].id, section, text, JSON.stringify(opts), correct, i + 1]);
    }
  }
};
