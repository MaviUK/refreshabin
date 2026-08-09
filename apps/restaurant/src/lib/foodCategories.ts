export type FoodCategoryGroup = {
  label: string
  description: string
  categories: string[]
}

export const foodCategoryGroups: FoodCategoryGroup[] = [
  {
    label: 'Popular & takeaway',
    description: 'Common takeaway styles and customer favourites.',
    categories: [
      'Pizza', 'Burgers', 'Smash Burgers', 'Chicken', 'Fried Chicken', 'Wings',
      'Kebab', 'Fish & Chips', 'Fast Food', 'Street Food', 'Sandwiches', 'Wraps',
      'Meal Deals', 'Family Meals',
    ],
  },
  {
    label: 'British & European',
    description: 'British, Irish and continental European food.',
    categories: [
      'British', 'Irish', 'Italian', 'Pasta', 'French', 'Greek', 'Mediterranean',
      'Spanish', 'Tapas', 'Portuguese', 'German', 'Polish', 'Eastern European',
      'European',
    ],
  },
  {
    label: 'South Asian',
    description: 'Indian subcontinent cuisines and regional specialities.',
    categories: [
      'Indian', 'Pakistani', 'Bangladeshi', 'Sri Lankan', 'Nepalese',
    ],
  },
  {
    label: 'East & Southeast Asian',
    description: 'Chinese, Japanese, Korean and Southeast Asian cuisines.',
    categories: [
      'Chinese', 'Cantonese', 'Sichuan', 'Thai', 'Vietnamese', 'Japanese', 'Sushi',
      'Korean', 'Malaysian', 'Indonesian', 'Filipino', 'Singaporean', 'Poke',
    ],
  },
  {
    label: 'Middle Eastern & Mediterranean',
    description: 'Middle Eastern and Eastern Mediterranean food.',
    categories: [
      'Turkish', 'Lebanese', 'Middle Eastern', 'Persian', 'Levantine', 'Shawarma',
      'Falafel',
    ],
  },
  {
    label: 'Americas & Caribbean',
    description: 'North, Central and South American cuisines.',
    categories: [
      'American', 'BBQ', 'Steak', 'Mexican', 'Tex-Mex', 'Brazilian', 'Argentinian',
      'Caribbean', 'Jamaican', 'Peruvian',
    ],
  },
  {
    label: 'African',
    description: 'African cuisines and regional food traditions.',
    categories: [
      'African', 'West African', 'Nigerian', 'Ethiopian', 'Moroccan', 'South African',
    ],
  },
  {
    label: 'Seafood',
    description: 'Fish, shellfish and seafood-led menus.',
    categories: ['Seafood', 'Fish', 'Shellfish'],
  },
  {
    label: 'Breakfast, cafe & bakery',
    description: 'Morning food, cafe favourites and baked goods.',
    categories: [
      'Breakfast', 'Brunch', 'Cafe', 'Coffee', 'Bakery', 'Bagels', 'Pancakes',
      'Waffles', 'Doughnuts',
    ],
  },
  {
    label: 'Healthy & lifestyle',
    description: 'Useful dietary and lifestyle discovery categories.',
    categories: [
      'Healthy', 'Salads', 'Vegan', 'Vegetarian', 'Plant-Based',
      'Gluten-Free Options', 'High Protein', 'Halal',
    ],
  },
  {
    label: 'Desserts & drinks',
    description: 'Sweet treats and specialist drink venues.',
    categories: [
      'Desserts', 'Ice Cream', 'Cakes', 'Cookies', 'Crepes', 'Bubble Tea',
      'Smoothies', 'Milkshakes', 'Juice',
    ],
  },
]

export const foodCategories = foodCategoryGroups.flatMap((group) => group.categories)

export const featuredFoodCategories = [
  'Pizza', 'Burgers', 'Chicken', 'Chinese', 'Indian', 'Fish & Chips', 'Kebab',
  'Italian', 'Thai', 'Japanese', 'Mexican', 'Breakfast', 'Desserts', 'Healthy',
]
