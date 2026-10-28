// Common menu and receipt words. Used only to repair the reader's i/l mix-ups
// ("Bolled" -> "Boiled"). A word is changed only when the original isn't on this
// list and swapping i/l/1 turns it into a word that is.
const LIST = `
add added ahi aioli al ale alfredo all almond americano amount and angus apple appetizer appetizers arugula asada asahi asian avocado
bacon bagel baguette baked balance balsamic bamboo banana bao barbecue basil basmati bbq bean beans beef beer beers beet bell bento berry
beverage beverages bibimbap biryani biscuit bisque black blt blue blueberry boba boiled bok bowl bowls braised bread breakfast brie brisket
broccoli broth brownie brunch bruschetta brussels bulgogi bun buns burger burrito butter buttermilk cabbage caesar cajun cake calamari
california calzone cappuccino caprese carbonara carne carnitas carrot cashew cauliflower caviar cesar chai chalupa champagne chardonnay
charge chashu cheddar cheese cheesecake chef chicken chile chili chilli chimichanga chip chips chipotle chive chocolate chop chorizo chow
chowder churro chutney cider cilantro cinnamon citrus clam clams classic club cobb cocktail coconut cod coffee coke cola cold coleslaw combo
corn crab cream creamy crepe crispy croissant croquette crudo crunch crunchy cucumber cumin curry custard cutlet dal dark deluxe dessert
diet dill dim dine dining dip discount double dough dragon dressing drink drinks duck dumpling dumplings dynamite edamame eel egg eggplant
eggs enchilada espresso extra falafel fettuccine filet fillet fire fish flan flatbread fondue fresh fried fries frita frittata fritter
fritters frozen fruit fudge fusilli garden garlic ginger glass glazed gluten gnocchi goat gorgonzola gratuity gravy greek green grill
grilled grits guacamole gyoza gyro half halibut ham hamachi hash hazelnut herb hoisin honey horchata hot house hummus ice iced inari
include included india indian italian jalapeno jam jasmine juice kalbi kale karaage katsu kebab kids kimchi kiwi korean lager lamb large
lasagna latte lemon lemonade lentil lettuce light lime linguine lobster lo lunch macaroni mahi main mango maple margarita margherita
marinara marinated martini masala mashed matcha meal meat meatball meatballs medium mein melt mild milk milkshake mimosa mint miso mixed
mocha mojito mozzarella muffin mushroom mushrooms mussels naan nachos nigiri noodle noodles nut nuts octopus oil olive olives omelet
omelette onion onions orange order oyster oysters pad paella pancake pancakes paneer panini panko parmesan pasta pastrami pastry pea peach
peanut pear pecan penne pepper pepperoni peppers pesto pho pickle pickled pickles pie pilsner pineapple pinot pita pizza plain plate
platter poached poke pork potato potatoes poutine prawn prawns pretzel prime prosciutto pudding pulled quesadilla quinoa radish rainbow
ramen ranch raspberry ravioli red regular ribeye ribs rice ricotta risotto roast roasted roll rolls rose rosemary rye saba sake salad
salads salami salmon salsa salt salted sandwich sangria sashimi sauce sausage sauteed scallion scallop scallops scrambled seafood seared
seaweed sesame shake shallot short shrimp side sides sirloin slaw slice sliced slider sliders small smoked smoothie soda soft soup sour
soy spaghetti special spicy spinach spring sprite squid steak steamed stew sticky strawberry street stuffed subtotal sugar sushi sweet
swiss syrup taco tacos tahini tamago tandoori tapas tart tea tempura tenders tequila teriyaki thai thigh tikka tilapia tiramisu toast
toasted tobiko tofu tomato tomatoes tonkotsu toro tortilla total tots tuna turkey tzatziki udon unagi vanilla veal vegan vegetable
vegetables veggie veggies vinaigrette vindaloo vodka waffle walnut wasabi water watermelon wedge whiskey white wild wine wings wonton
wrap yakisoba yakitori yam yellow yogurt yuzu zucchini
`;

export const WORDS = new Set(LIST.split(/\s+/).filter(Boolean));
