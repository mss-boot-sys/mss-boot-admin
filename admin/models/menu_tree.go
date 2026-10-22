package models

import "sort"

// MaxMenuDepth bounds API writes and tree traversal consistently, including
// historical data written before hierarchy validation existed.
const MaxMenuDepth = 64

// BuildMenuTree builds each node once and never follows recursive parent links.
// Management views retain malformed historical nodes as separate roots so an
// operator can repair them. Authorization projections omit those nodes instead.
func BuildMenuTree(list []*Menu, parentID string, recoverInvalid bool) []*Menu {
	byID := make(map[string]*Menu, len(list))
	ordered := make([]*Menu, 0, len(list))
	for _, source := range list {
		if source == nil || source.ID == "" || byID[source.ID] != nil {
			continue
		}
		copy := *source
		copy.Children = nil
		byID[copy.ID] = &copy
		ordered = append(ordered, &copy)
	}
	valid := make(map[string]bool, len(ordered))
	for _, menu := range ordered {
		seen := map[string]bool{menu.ID: true}
		depth, ancestorID := 1, menu.ParentID
		ok := true
		for ancestorID != "" {
			ancestor := byID[ancestorID]
			if ancestor == nil || seen[ancestorID] || depth >= MaxMenuDepth {
				ok = false
				break
			}
			seen[ancestorID] = true
			depth++
			ancestorID = ancestor.ParentID
		}
		valid[menu.ID] = ok
	}
	roots := make([]*Menu, 0)
	for _, menu := range ordered {
		if !valid[menu.ID] {
			if recoverInvalid && parentID == "" {
				roots = append(roots, menu)
			}
			continue
		}
		if menu.ParentID == parentID {
			roots = append(roots, menu)
		} else if parent := byID[menu.ParentID]; parent != nil {
			parent.Children = append(parent.Children, menu)
		}
	}
	less := func(items []*Menu) {
		sort.SliceStable(items, func(i, j int) bool {
			if items[i].Sort != items[j].Sort {
				return items[i].Sort > items[j].Sort
			}
			return items[i].ID < items[j].ID
		})
	}
	less(roots)
	for _, menu := range ordered {
		less(menu.Children)
	}
	return roots
}
