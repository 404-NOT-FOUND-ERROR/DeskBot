export interface Preset {
  label: string;
  text: string;
}

export const PRESETS: readonly Preset[] = [
  { label: "Bakery fire sale", text: "There is a fire sale at the bakery. Everything must go, right now." },
  { label: "Snake at the fountain", text: "A poisonous snake was just spotted loose near the fountain. Stay away." },
  { label: "Free gold", text: "Someone dropped a bag of gold coins in the plaza. First come, first served." },
  { label: "Mysterious light", text: "A strange blue light is flickering above the watchtower. Nobody knows why." },
  { label: "The mayor is missing", text: "The mayor has not been seen since sunrise. The Council is asking questions." },
  { label: "Storm warning", text: "A storm is rolling in fast from the coast. It will hit within the hour." },
  { label: "Free festival", text: "A surprise festival is starting right now in the plaza, with food and music for everyone." },
  { label: "Dragon sighting", text: "A dragon was just seen circling the hills outside town." },
  { label: "Tax audit", text: "The Council is auditing everyone's taxes starting today. Records will be checked." },
  { label: "Nothing happened", text: "This is a routine test of the town announcement system. No action needed." },
];
