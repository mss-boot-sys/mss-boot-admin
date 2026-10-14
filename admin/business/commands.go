package business

import (
	"errors"
	"fmt"
	"regexp"

	"github.com/spf13/cobra"
)

// CommandFactory builds one host-binary subcommand contributed by a module.
type CommandFactory func() *cobra.Command

// reservedCommandNames belong to the host binary and Cobra itself.
var reservedCommandNames = map[string]struct{}{
	"server": {}, "migrate": {}, "help": {}, "completion": {}, "version": {},
	"config": {}, "admin": {},
}

var commandNamePattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,31}$`)

func validateCommands(factories []CommandFactory) ([]string, error) {
	names := make([]string, 0, len(factories))
	seen := map[string]struct{}{}
	for index, factory := range factories {
		if factory == nil {
			return nil, fmt.Errorf("command factory %d is nil", index)
		}
		command := factory()
		if command == nil {
			return nil, fmt.Errorf("command factory %d returned nil", index)
		}
		name := command.Name()
		if !commandNamePattern.MatchString(name) {
			return nil, fmt.Errorf("command name %q must match %s", name, commandNamePattern)
		}
		if _, reserved := reservedCommandNames[name]; reserved {
			return nil, fmt.Errorf("command name %q is reserved by the host", name)
		}
		if len(command.Aliases) > 0 {
			return nil, fmt.Errorf("command %q must not declare aliases", name)
		}
		if _, dup := seen[name]; dup {
			return nil, fmt.Errorf("command %q is declared twice", name)
		}
		seen[name] = struct{}{}
		names = append(names, name)
	}
	return names, nil
}

// Commands builds fresh module subcommands in composition order. It requires
// a frozen registry so the command set matches the validated composition.
func (r *Registry) Commands() ([]*cobra.Command, error) {
	if r == nil {
		return nil, errors.New("business module registry is required")
	}
	if r.transactionView() {
		return nil, r.rejectTransactionLifecycle("Commands")
	}
	r.mu.RLock()
	if !r.frozen {
		r.mu.RUnlock()
		return nil, ErrRegistryNotFrozen
	}
	entries := append([]entry(nil), r.entries...)
	r.mu.RUnlock()
	commands := []*cobra.Command{}
	for _, registered := range entries {
		for index, factory := range registered.commands {
			command := factory()
			if command == nil || command.Name() != registered.commandNames[index] {
				return nil, fmt.Errorf("business module %s command factory %d is not deterministic", registered.name, index)
			}
			commands = append(commands, command)
		}
	}
	return commands, nil
}
