// The words in the example dashboard's made-up data (./seed.ts), in each app language: Alex, who has rheumatoid
// arthritis, their medications, care team, appointments, records, and plans. Numbers and dates live in the seed.
import type { Lang } from "../i18n";

export type DemoContent = {
  name: string;
  place: string;
  location: string;
  stiffness: string;
  fatigue: string;
  painNote: string;
  painHelped: string;
  meds: { mtx: string; folic: string; hcq: string; ibu: string };
  withFood: string;
  weekly: string;
  doseChange: string;
  nausea: string;
  team: { rheum: string; pt: string; pcp: string; clinic: string; ptClinic: string; pcpClinic: string };
  roles: { rheum: string; pt: string; pcp: string };
  visits: { rheum: string; labs: string; pt: string; physical: string; rheumNotes: string; labsNotes: string; physicalNotes: string; ptPrep: string };
  questions: string[];
  exercises: { hands: string; handsNotes: string; walk: string; knees: string };
  records: { labs: string; lab: string; letter: string; summaryOld: string; summaryNew: string; letterSummary: string };
  labs: { crp: string; esr: string; alt: string; wbc: string };
  emergency: { partner: string; doctor: string; flare: string; flareSteps: string[]; meds: string; medsSteps: string[]; notes: string };
  circle: { member: string; invite: string };
  agent: { title: string; reason: string; subject: string; body: string; pain: string; pressure: string; doneTitle: string; doneReason: string; doneResult: string };
  facts: string[];
  share: string;
  visitSummary: string;
};

const en: DemoContent = {
  name: "Alex",
  place: "Portland, Oregon",
  location: "Portland, OR",
  stiffness: "morning stiffness",
  fatigue: "fatigue",
  painNote: "Knuckles and knees worse since the rain started.",
  painHelped: "Warm water, resting my hands",
  meds: { mtx: "Methotrexate", folic: "Folic acid", hcq: "Hydroxychloroquine", ibu: "Ibuprofen" },
  withFood: "With food",
  weekly: "Once a week, with food",
  doseChange: "15 mg to 20 mg a week",
  nausea: "Nausea",
  team: { rheum: "Dr. Maya Chen", pt: "Sam Rivera", pcp: "Dr. Priya Patel", clinic: "Riverside Rheumatology", ptClinic: "Eastside Physical Therapy", pcpClinic: "Hawthorne Family Medicine" },
  roles: { rheum: "Rheumatologist", pt: "Physical therapist", pcp: "Primary care doctor" },
  visits: {
    rheum: "Rheumatology check-up",
    labs: "Blood test",
    pt: "Physical therapy",
    physical: "Annual physical",
    rheumNotes: "Raised methotrexate to 20 mg a week. Blood test in 2 weeks to check liver and blood counts. Keep ibuprofen to bad days.",
    labsNotes: "Fasting not needed.",
    physicalNotes: "Blood pressure fine. Flu shot done.",
    ptPrep: "Ask about exercises for stiff mornings.",
  },
  questions: ["Could my flares be linked to drops in air pressure?", "Is it safe to keep taking ibuprofen most days?", "What should I do on days the pain is above 7?"],
  exercises: { hands: "Hand and finger stretches", handsNotes: "Soak hands in warm water first.", walk: "Gentle walk", knees: "Knee strengthening" },
  records: {
    labs: "Blood test results",
    lab: "Riverside Lab",
    letter: "Letter from Dr. Chen",
    summaryOld: "Inflammation markers (CRP and ESR) are high, which fits active rheumatoid arthritis. Liver test and white cells are normal.",
    summaryNew: "Inflammation markers have come down since the last test, and CRP is now in the normal range. Liver test and white cells are still normal on the higher methotrexate dose.",
    letterSummary: "Dr. Chen raised methotrexate to 20 mg a week because of ongoing flares, with folic acid daily and a blood test in 2 weeks.",
  },
  labs: {
    crp: "C-reactive protein shows inflammation in the body. Lower is better for rheumatoid arthritis.",
    esr: "The sed rate is another sign of inflammation. It often falls when treatment is working.",
    alt: "ALT checks the liver, which methotrexate can affect. This value is normal.",
    wbc: "White blood cells fight infection. Methotrexate can lower them, so they are checked regularly.",
  },
  emergency: {
    partner: "Partner",
    doctor: "Rheumatologist",
    flare: "If I have a bad flare",
    flareSteps: ["Rest the sore joints and use warm water or a heat pad.", "Take ibuprofen with food, no more than 3 a day.", "Call Dr. Chen's office if it lasts more than 3 days."],
    meds: "My medications",
    medsSteps: ["Methotrexate 20 mg once a week, on the same day.", "No alcohol while on methotrexate.", "Fever or a bad infection: call the doctor before the next methotrexate dose."],
    notes: "Allergic to penicillin.",
  },
  circle: { member: "Jordan", invite: "Mom" },
  agent: {
    title: "Message Dr. Chen about flares on low pressure days",
    reason: "Joint pain has been 7 or more on most days the air pressure dropped this month. Your check-up is in 3 days, so Dr. Chen could look at it first.",
    subject: "Flares on days the air pressure drops",
    body: "Hi Dr. Chen,\n\nMy joint pain has been 7/10 or worse on most days the air pressure dropped this month, and about 4/10 on other days. It has been better since the methotrexate dose went up. Could we talk about this at my check-up?\n\nThanks,\nAlex",
    pain: "Joint pain on pressure drop days",
    pressure: "Joint pain on other days",
    doneTitle: "Remind me to book a blood test",
    doneReason: "Dr. Chen asked for a blood test 2 weeks after the dose change.",
    doneResult: "Blood test booked.",
  },
  facts: ["Has rheumatoid arthritis, diagnosed in 2021", "Allergic to penicillin"],
  share: "Dr. Chen",
  visitSummary:
    "## Visit summary\n\n**Main concern:** joint pain flares, mostly in the hands and knees.\n\n- Joint pain averaged about 4/10 over the last 30 days, with flares of 7 to 9 on days the air pressure dropped.\n- Pain has been lower since methotrexate went up to 20 mg a week (about 6/10 in the 2 weeks before, about 4/10 after).\n- Morning stiffness most days; fatigue on flare days.\n- Took nearly all doses. Ibuprofen on flare days.\n\n**Questions to ask**\n\n- Could my flares be linked to drops in air pressure?\n- Is it safe to keep taking ibuprofen most days?\n\n*Example summary for a made-up person.*",
};

const es: DemoContent = {
  name: "Alex",
  place: "Portland, Oregón",
  location: "Portland, OR",
  stiffness: "rigidez matutina",
  fatigue: "cansancio",
  painNote: "Nudillos y rodillas peor desde que empezó a llover.",
  painHelped: "Agua tibia, descansar las manos",
  meds: { mtx: "Metotrexato", folic: "Ácido fólico", hcq: "Hidroxicloroquina", ibu: "Ibuprofeno" },
  withFood: "Con comida",
  weekly: "Una vez a la semana, con comida",
  doseChange: "De 15 mg a 20 mg por semana",
  nausea: "Náuseas",
  team: { rheum: "Dra. Maya Chen", pt: "Sam Rivera", pcp: "Dra. Priya Patel", clinic: "Reumatología Riverside", ptClinic: "Fisioterapia Eastside", pcpClinic: "Medicina Familiar Hawthorne" },
  roles: { rheum: "Reumatóloga", pt: "Fisioterapeuta", pcp: "Médica de cabecera" },
  visits: {
    rheum: "Revisión de reumatología",
    labs: "Análisis de sangre",
    pt: "Fisioterapia",
    physical: "Chequeo anual",
    rheumNotes: "Subió el metotrexato a 20 mg por semana. Análisis de sangre en 2 semanas para revisar el hígado y los glóbulos. Ibuprofeno solo en días malos.",
    labsNotes: "No hace falta ayunar.",
    physicalNotes: "Presión arterial bien. Vacuna de la gripe puesta.",
    ptPrep: "Preguntar por ejercicios para las mañanas con rigidez.",
  },
  questions: ["¿Pueden mis brotes estar ligados a las bajadas de presión atmosférica?", "¿Es seguro seguir tomando ibuprofeno casi todos los días?", "¿Qué hago los días en que el dolor pasa de 7?"],
  exercises: { hands: "Estiramientos de manos y dedos", handsNotes: "Antes, meter las manos en agua tibia.", walk: "Paseo suave", knees: "Fortalecimiento de rodillas" },
  records: {
    labs: "Resultados del análisis de sangre",
    lab: "Laboratorio Riverside",
    letter: "Carta de la Dra. Chen",
    summaryOld: "Los marcadores de inflamación (PCR y VSG) están altos, lo que encaja con una artritis reumatoide activa. La prueba del hígado y los glóbulos blancos están normales.",
    summaryNew: "Los marcadores de inflamación han bajado desde el último análisis y la PCR ya está en el rango normal. El hígado y los glóbulos blancos siguen normales con la dosis más alta de metotrexato.",
    letterSummary: "La Dra. Chen subió el metotrexato a 20 mg por semana por los brotes, con ácido fólico diario y un análisis de sangre en 2 semanas.",
  },
  labs: {
    crp: "La proteína C reactiva muestra inflamación en el cuerpo. En la artritis reumatoide, cuanto más baja, mejor.",
    esr: "La velocidad de sedimentación es otra señal de inflamación. Suele bajar cuando el tratamiento funciona.",
    alt: "La ALT revisa el hígado, al que puede afectar el metotrexato. Este valor es normal.",
    wbc: "Los glóbulos blancos combaten las infecciones. El metotrexato puede bajarlos, así que se revisan a menudo.",
  },
  emergency: {
    partner: "Pareja",
    doctor: "Reumatóloga",
    flare: "Si tengo un brote fuerte",
    flareSteps: ["Descansar las articulaciones y usar agua tibia o una almohadilla de calor.", "Tomar ibuprofeno con comida, no más de 3 al día.", "Llamar a la consulta de la Dra. Chen si dura más de 3 días."],
    meds: "Mis medicamentos",
    medsSteps: ["Metotrexato 20 mg una vez a la semana, siempre el mismo día.", "Nada de alcohol con el metotrexato.", "Con fiebre o una infección fuerte: llamar a la médica antes de la siguiente dosis de metotrexato."],
    notes: "Alergia a la penicilina.",
  },
  circle: { member: "Jordan", invite: "Mamá" },
  agent: {
    title: "Escribir a la Dra. Chen sobre los brotes con presión baja",
    reason: "El dolor articular ha sido de 7 o más casi todos los días en que bajó la presión este mes. La revisión es en 3 días, así que la Dra. Chen podría verlo antes.",
    subject: "Brotes los días en que baja la presión atmosférica",
    body: "Hola, Dra. Chen:\n\nEste mes, el dolor articular ha sido de 7/10 o más casi todos los días en que bajó la presión atmosférica, y de unos 4/10 el resto. Ha mejorado desde que subió la dosis de metotrexato. ¿Podemos hablarlo en la revisión?\n\nGracias,\nAlex",
    pain: "Dolor articular con bajada de presión",
    pressure: "Dolor articular el resto de días",
    doneTitle: "Recordarme pedir cita para el análisis",
    doneReason: "La Dra. Chen pidió un análisis 2 semanas después del cambio de dosis.",
    doneResult: "Análisis reservado.",
  },
  facts: ["Tiene artritis reumatoide, diagnosticada en 2021", "Alergia a la penicilina"],
  share: "Dra. Chen",
  visitSummary:
    "## Resumen para la consulta\n\n**Motivo principal:** brotes de dolor articular, sobre todo en manos y rodillas.\n\n- El dolor articular fue de unos 4/10 de media en los últimos 30 días, con brotes de 7 a 9 los días en que bajó la presión atmosférica.\n- El dolor ha bajado desde que el metotrexato subió a 20 mg por semana (unos 6/10 las 2 semanas antes, unos 4/10 después).\n- Rigidez matutina casi todos los días; cansancio en los días de brote.\n- Tomó casi todas las dosis. Ibuprofeno en los días de brote.\n\n**Preguntas para la consulta**\n\n- ¿Pueden mis brotes estar ligados a las bajadas de presión atmosférica?\n- ¿Es seguro seguir tomando ibuprofeno casi todos los días?\n\n*Resumen de ejemplo de una persona inventada.*",
};

const el: DemoContent = {
  name: "Άλεξ",
  place: "Πόρτλαντ, Όρεγκον",
  location: "Portland, OR",
  stiffness: "πρωινή δυσκαμψία",
  fatigue: "κούραση",
  painNote: "Χειρότερα στις αρθρώσεις των δαχτύλων και στα γόνατα από τότε που άρχισε η βροχή.",
  painHelped: "Ζεστό νερό, ξεκούραση των χεριών",
  meds: { mtx: "Μεθοτρεξάτη", folic: "Φολικό οξύ", hcq: "Υδροξυχλωροκίνη", ibu: "Ιβουπροφαίνη" },
  withFood: "Με φαγητό",
  weekly: "Μία φορά την εβδομάδα, με φαγητό",
  doseChange: "Από 15 mg σε 20 mg την εβδομάδα",
  nausea: "Ναυτία",
  team: { rheum: "Δρ. Μάγια Τσεν", pt: "Σαμ Ριβέρα", pcp: "Δρ. Πρίγια Πατέλ", clinic: "Ρευματολογικό Riverside", ptClinic: "Φυσικοθεραπεία Eastside", pcpClinic: "Οικογενειακή Ιατρική Hawthorne" },
  roles: { rheum: "Ρευματολόγος", pt: "Φυσικοθεραπευτής", pcp: "Γενική ιατρός" },
  visits: {
    rheum: "Επίσκεψη στον ρευματολόγο",
    labs: "Εξέταση αίματος",
    pt: "Φυσικοθεραπεία",
    physical: "Ετήσιος έλεγχος",
    rheumNotes: "Η μεθοτρεξάτη ανέβηκε στα 20 mg την εβδομάδα. Εξέταση αίματος σε 2 εβδομάδες για συκώτι και αιμοσφαίρια. Ιβουπροφαίνη μόνο τις κακές μέρες.",
    labsNotes: "Δεν χρειάζεται νηστεία.",
    physicalNotes: "Η πίεση είναι καλή. Έγινε το εμβόλιο της γρίπης.",
    ptPrep: "Ρώτα για ασκήσεις για τα δύσκαμπτα πρωινά.",
  },
  questions: ["Μπορεί οι εξάρσεις μου να συνδέονται με τις πτώσεις της ατμοσφαιρικής πίεσης;", "Είναι ασφαλές να συνεχίσω την ιβουπροφαίνη σχεδόν κάθε μέρα;", "Τι να κάνω τις μέρες που ο πόνος περνά το 7;"],
  exercises: { hands: "Διατάσεις χεριών και δαχτύλων", handsNotes: "Πρώτα τα χέρια σε ζεστό νερό.", walk: "Ήπιο περπάτημα", knees: "Ενδυνάμωση γονάτων" },
  records: {
    labs: "Αποτελέσματα εξέτασης αίματος",
    lab: "Εργαστήριο Riverside",
    letter: "Επιστολή της Δρ. Τσεν",
    summaryOld: "Οι δείκτες φλεγμονής (CRP και ΤΚΕ) είναι υψηλοί, όπως συμβαίνει σε ενεργή ρευματοειδή αρθρίτιδα. Η εξέταση του ήπατος και τα λευκά αιμοσφαίρια είναι φυσιολογικά.",
    summaryNew: "Οι δείκτες φλεγμονής έπεσαν από την προηγούμενη εξέταση και η CRP είναι πια φυσιολογική. Ήπαρ και λευκά αιμοσφαίρια παραμένουν φυσιολογικά με την υψηλότερη δόση μεθοτρεξάτης.",
    letterSummary: "Η Δρ. Τσεν αύξησε τη μεθοτρεξάτη στα 20 mg την εβδομάδα λόγω των εξάρσεων, με φολικό οξύ κάθε μέρα και εξέταση αίματος σε 2 εβδομάδες.",
  },
  labs: {
    crp: "Η C-αντιδρώσα πρωτεΐνη δείχνει φλεγμονή στο σώμα. Στη ρευματοειδή αρθρίτιδα, όσο χαμηλότερη τόσο καλύτερα.",
    esr: "Η ΤΚΕ είναι άλλο ένα σημάδι φλεγμονής. Συνήθως πέφτει όταν η θεραπεία δουλεύει.",
    alt: "Η ALT ελέγχει το ήπαρ, που μπορεί να επηρεάσει η μεθοτρεξάτη. Η τιμή είναι φυσιολογική.",
    wbc: "Τα λευκά αιμοσφαίρια πολεμούν τις λοιμώξεις. Η μεθοτρεξάτη μπορεί να τα μειώσει, γι' αυτό ελέγχονται τακτικά.",
  },
  emergency: {
    partner: "Σύντροφος",
    doctor: "Ρευματολόγος",
    flare: "Αν έχω δυνατή έξαρση",
    flareSteps: ["Ξεκούραση στις πονεμένες αρθρώσεις και ζεστό νερό ή θερμοφόρα.", "Ιβουπροφαίνη με φαγητό, έως 3 την ημέρα.", "Τηλέφωνο στο ιατρείο της Δρ. Τσεν αν κρατήσει πάνω από 3 μέρες."],
    meds: "Τα φάρμακά μου",
    medsSteps: ["Μεθοτρεξάτη 20 mg μία φορά την εβδομάδα, την ίδια μέρα.", "Καθόλου αλκοόλ με τη μεθοτρεξάτη.", "Με πυρετό ή σοβαρή λοίμωξη: τηλέφωνο στον γιατρό πριν από την επόμενη δόση μεθοτρεξάτης."],
    notes: "Αλλεργία στην πενικιλίνη.",
  },
  circle: { member: "Τζόρνταν", invite: "Μαμά" },
  agent: {
    title: "Μήνυμα στη Δρ. Τσεν για τις εξάρσεις με χαμηλή πίεση",
    reason: "Ο πόνος στις αρθρώσεις ήταν 7 ή πάνω τις περισσότερες μέρες που έπεσε η πίεση αυτόν τον μήνα. Η επίσκεψη είναι σε 3 μέρες, οπότε η Δρ. Τσεν θα μπορούσε να το δει πρώτα.",
    subject: "Εξάρσεις τις μέρες που πέφτει η ατμοσφαιρική πίεση",
    body: "Γεια σας, Δρ. Τσεν,\n\nΑυτόν τον μήνα ο πόνος στις αρθρώσεις ήταν 7/10 ή χειρότερος τις περισσότερες μέρες που έπεσε η ατμοσφαιρική πίεση, και γύρω στο 4/10 τις άλλες. Είναι καλύτερα από τότε που ανέβηκε η δόση της μεθοτρεξάτης. Μπορούμε να το συζητήσουμε στην επίσκεψη;\n\nΕυχαριστώ,\nΆλεξ",
    pain: "Πόνος τις μέρες με πτώση πίεσης",
    pressure: "Πόνος τις υπόλοιπες μέρες",
    doneTitle: "Υπενθύμιση για ραντεβού εξέτασης αίματος",
    doneReason: "Η Δρ. Τσεν ζήτησε εξέταση αίματος 2 εβδομάδες μετά την αλλαγή δόσης.",
    doneResult: "Κλείστηκε η εξέταση αίματος.",
  },
  facts: ["Έχει ρευματοειδή αρθρίτιδα από το 2021", "Αλλεργία στην πενικιλίνη"],
  share: "Δρ. Τσεν",
  visitSummary:
    "## Σύνοψη για την επίσκεψη\n\n**Κύριο θέμα:** εξάρσεις πόνου στις αρθρώσεις, κυρίως σε χέρια και γόνατα.\n\n- Ο πόνος ήταν κατά μέσο όρο γύρω στο 4/10 τις τελευταίες 30 μέρες, με εξάρσεις 7 έως 9 τις μέρες που έπεσε η ατμοσφαιρική πίεση.\n- Ο πόνος είναι χαμηλότερος από τότε που η μεθοτρεξάτη ανέβηκε στα 20 mg την εβδομάδα (περίπου 6/10 τις 2 εβδομάδες πριν, περίπου 4/10 μετά).\n- Πρωινή δυσκαμψία τις περισσότερες μέρες, κούραση τις μέρες έξαρσης.\n- Σχεδόν όλες οι δόσεις πάρθηκαν. Ιβουπροφαίνη τις μέρες έξαρσης.\n\n**Ερωτήσεις για τον γιατρό**\n\n- Μπορεί οι εξάρσεις μου να συνδέονται με τις πτώσεις της ατμοσφαιρικής πίεσης;\n- Είναι ασφαλές να συνεχίσω την ιβουπροφαίνη σχεδόν κάθε μέρα;\n\n*Παράδειγμα σύνοψης για ένα φανταστικό πρόσωπο.*",
};

const zh: DemoContent = {
  name: "Alex",
  place: "俄勒冈州波特兰",
  location: "Portland, OR",
  stiffness: "晨僵",
  fatigue: "疲劳",
  painNote: "开始下雨后，指关节和膝盖更疼了。",
  painHelped: "温水泡手、让手休息",
  meds: { mtx: "甲氨蝶呤", folic: "叶酸", hcq: "羟氯喹", ibu: "布洛芬" },
  withFood: "随餐服用",
  weekly: "每周一次，随餐服用",
  doseChange: "每周 15 mg 增至 20 mg",
  nausea: "恶心",
  team: { rheum: "Maya Chen 医生", pt: "Sam Rivera", pcp: "Priya Patel 医生", clinic: "Riverside 风湿科", ptClinic: "Eastside 物理治疗", pcpClinic: "Hawthorne 家庭医学" },
  roles: { rheum: "风湿科医生", pt: "物理治疗师", pcp: "家庭医生" },
  visits: {
    rheum: "风湿科复诊",
    labs: "验血",
    pt: "物理治疗",
    physical: "年度体检",
    rheumNotes: "甲氨蝶呤增至每周 20 mg。2 周后验血，查肝功能和血细胞。布洛芬只在疼得厉害的日子吃。",
    labsNotes: "不需要空腹。",
    physicalNotes: "血压正常。已打流感疫苗。",
    ptPrep: "问问早上僵硬时可以做哪些运动。",
  },
  questions: ["我的发作会不会和气压下降有关？", "几乎每天吃布洛芬安全吗？", "疼痛超过 7 分的日子我该怎么办？"],
  exercises: { hands: "手部和手指伸展", handsNotes: "先用温水泡手。", walk: "轻松散步", knees: "膝盖力量训练" },
  records: {
    labs: "验血结果",
    lab: "Riverside 化验室",
    letter: "Chen 医生的信",
    summaryOld: "炎症指标（CRP 和血沉）偏高，符合活动期类风湿关节炎。肝功能和白细胞正常。",
    summaryNew: "炎症指标比上次下降，CRP 已回到正常范围。加大甲氨蝶呤剂量后，肝功能和白细胞仍然正常。",
    letterSummary: "由于持续发作，Chen 医生把甲氨蝶呤加到每周 20 mg，每天服用叶酸，2 周后验血。",
  },
  labs: {
    crp: "C 反应蛋白反映体内的炎症。对类风湿关节炎来说，越低越好。",
    esr: "血沉是另一个炎症指标，治疗起效时通常会下降。",
    alt: "ALT 用来检查肝脏，甲氨蝶呤可能影响肝脏。这个值正常。",
    wbc: "白细胞负责对抗感染。甲氨蝶呤可能让它降低，所以要定期检查。",
  },
  emergency: {
    partner: "伴侣",
    doctor: "风湿科医生",
    flare: "如果发作得厉害",
    flareSteps: ["让疼痛的关节休息，用温水或热敷垫。", "随餐服用布洛芬，每天不超过 3 片。", "持续超过 3 天就给 Chen 医生的诊所打电话。"],
    meds: "我的用药",
    medsSteps: ["甲氨蝶呤 20 mg，每周一次，固定在同一天。", "服用甲氨蝶呤期间不喝酒。", "发烧或严重感染：下次服用甲氨蝶呤前先打电话问医生。"],
    notes: "对青霉素过敏。",
  },
  circle: { member: "Jordan", invite: "妈妈" },
  agent: {
    title: "就气压低时的发作给 Chen 医生发消息",
    reason: "本月气压下降的日子里，关节痛大多在 7 分或以上。3 天后就要复诊，可以让 Chen 医生先看看。",
    subject: "气压下降的日子会发作",
    body: "Chen 医生您好：\n\n这个月气压下降的日子里，我的关节痛大多在 7/10 或更高，其他日子大约 4/10。甲氨蝶呤加量后有所好转。复诊时能聊聊这个吗？\n\n谢谢，\nAlex",
    pain: "气压下降日的关节痛",
    pressure: "其他日子的关节痛",
    doneTitle: "提醒我预约验血",
    doneReason: "Chen 医生要求剂量调整 2 周后验血。",
    doneResult: "已预约验血。",
  },
  facts: ["2021 年确诊类风湿关节炎", "对青霉素过敏"],
  share: "Chen 医生",
  visitSummary:
    "## 就诊摘要\n\n**主要问题：**关节痛发作，主要在手和膝盖。\n\n- 过去 30 天关节痛平均约 4/10，气压下降的日子发作到 7 至 9 分。\n- 甲氨蝶呤加到每周 20 mg 后疼痛减轻（之前 2 周约 6/10，之后约 4/10）。\n- 大多数日子有晨僵，发作日感到疲劳。\n- 几乎每剂都按时服用。发作日吃布洛芬。\n\n**想问医生的问题**\n\n- 我的发作会不会和气压下降有关？\n- 几乎每天吃布洛芬安全吗？\n\n*这是一个虚构人物的示例摘要。*",
};

export const DEMO_CONTENT: Record<Lang, DemoContent> = { en, es, el, zh };
